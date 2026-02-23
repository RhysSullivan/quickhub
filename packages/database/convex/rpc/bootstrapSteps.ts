/**
 * bootstrapSteps — Individual step actions for the durable bootstrap workflow.
 *
 * Each step fetches one category of data from the GitHub API and writes it
 * to the DB via bootstrapWrite mutations. They return lightweight summaries
 * so the workflow journal stays well within the 1 MiB limit.
 *
 * These are vanilla Convex `internalAction`s (not Confect) because they are
 * called by the workflow engine via `step.runAction()`.
 *
 * Large paginated fetches (PRs, issues) are split into "chunk" actions that
 * process N pages at a time. The workflow orchestrates a cursor loop so each
 * chunk is its own durable step — if one chunk times out, only that chunk
 * retries.
 *
 * Errors are allowed to throw (via `Effect.runPromise` + `Effect.orDie`).
 * The workflow's retry policy handles transient failures like rate limits.
 */

import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import { v } from "convex/values";
import { Effect } from "effect";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import { toOpenClosedState } from "../shared/coerce";
import {
	Issue,
	PullRequestSimple,
	type SimpleUser,
} from "../shared/generated_github_client";
import { fetchArrayLenient, GitHubApiClient } from "../shared/githubApi";
import { resolveRepoToken } from "../shared/githubToken";
import { parseIsoToMsOrNull as isoToMs } from "../shared/time";

// ---------------------------------------------------------------------------
// GitHub response parsing helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared user collector
// ---------------------------------------------------------------------------

type UserInput = Pick<
	typeof SimpleUser.Type,
	"id" | "login" | "avatar_url" | "site_admin" | "type"
>;

const createUserCollector = () => {
	const userMap = new Map<
		number,
		{
			githubUserId: number;
			login: string;
			avatarUrl: string | null;
			siteAdmin: boolean;
			type: "User" | "Bot" | "Organization";
		}
	>();

	const collectUser = (u: UserInput | null | undefined): number | null => {
		if (u == null) return null;
		const id = u.id;
		const login = u.login;
		if (!userMap.has(id)) {
			userMap.set(id, {
				githubUserId: id,
				login,
				avatarUrl: u.avatar_url,
				siteAdmin: u.site_admin,
				type:
					u.type === "Bot"
						? "Bot"
						: u.type === "Organization"
							? "Organization"
							: "User",
			});
		}
		return id;
	};

	return { collectUser, getUsers: () => [...userMap.values()] };
};

// ---------------------------------------------------------------------------
// Token resolution helpers
// ---------------------------------------------------------------------------

/**
 * Auth args passed to every bootstrap step.
 * Background sync resolves tokens from GitHub App installation IDs.
 * `connectedByUserId` remains for payload compatibility with existing workflow
 * records and call sites.
 */
type TokenArgs = {
	connectedByUserId: string | null;
	installationId: number;
};

/**
 * Resolve the best available token, then run an Effect that requires
 * `GitHubApiClient` in its environment.
 */
const runWithGitHub = <A>(
	ctx: ActionCtx,
	tokenArgs: TokenArgs,
	effect: Effect.Effect<A, never, GitHubApiClient>,
): Promise<A> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const token = yield* resolveRepoToken(
				ctx.runQuery,
				tokenArgs.connectedByUserId,
				tokenArgs.installationId,
			);
			return yield* Effect.provide(effect, GitHubApiClient.fromToken(token));
		}).pipe(Effect.orDie),
	);

/**
 * Resolve a GitHubApiClient service instance.
 * Returns the client directly so callers can use it across multiple
 * paginated calls without re-resolving the token each time.
 */
const resolveGitHubClient = (ctx: ActionCtx, tokenArgs: TokenArgs) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const token = yield* resolveRepoToken(
				ctx.runQuery,
				tokenArgs.connectedByUserId,
				tokenArgs.installationId,
			);
			return yield* Effect.provide(
				GitHubApiClient,
				GitHubApiClient.fromToken(token),
			);
		}).pipe(Effect.orDie),
	);

/**
 * Write collected users to the DB in batches of 50.
 */
const writeUsers = async (
	ctx: ActionCtx,
	users: ReturnType<ReturnType<typeof createUserCollector>["getUsers"]>,
) => {
	for (let i = 0; i < users.length; i += 50) {
		await ctx.runMutation(internal.rpc.bootstrapWrite.upsertUsers, {
			users: users.slice(i, i + 50),
		});
	}
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of GitHub API pages to process per chunk action.
 * Each page has up to 100 items. 10 pages = up to 1000 items per chunk.
 * This keeps each action well within the 10-minute Convex timeout.
 */
const PAGES_PER_CHUNK = 10;

/**
 * Common Convex validator args for token resolution.
 * Every step accepts these to keep workflow payload compatibility.
 * Runtime token resolution uses installationId.
 */
const tokenArgs = {
	connectedByUserId: v.union(v.string(), v.null()),
	installationId: v.number(),
};

/** Extract TokenArgs from step args. */
const toTokenArgs = (args: {
	connectedByUserId: string | null;
	installationId: number;
}): TokenArgs => ({
	connectedByUserId: args.connectedByUserId,
	installationId: args.installationId,
});

/**
 * Split "owner/repo" into [owner, repo].
 */
const splitFullName = (fullName: string): [string, string] => {
	const idx = fullName.indexOf("/");
	if (idx === -1) return [fullName, ""];
	return [fullName.slice(0, idx), fullName.slice(idx + 1)];
};

// ---------------------------------------------------------------------------
// Step 1: Fetch branches
// ---------------------------------------------------------------------------

export const fetchBranches = internalAction({
	args: {
		repositoryId: v.number(),
		fullName: v.string(),
		...tokenArgs,
	},
	returns: v.object({ count: v.number() }),
	handler: async (ctx, args): Promise<{ count: number }> => {
		const [owner, repo] = splitFullName(args.fullName);

		const rawBranches = await runWithGitHub(
			ctx,
			toTokenArgs(args),
			Effect.gen(function* () {
				const gh = yield* GitHubApiClient;
				return yield* gh.client
					.reposListBranches(owner, repo, { per_page: 100 })
					.pipe(Effect.orDie);
			}),
		);

		const branches = rawBranches.map((b) => ({
			name: b.name,
			headSha: b.commit.sha,
			protected: b.protected,
		}));

		await ctx.runMutation(internal.rpc.bootstrapWrite.upsertBranches, {
			repositoryId: args.repositoryId,
			branches,
		});

		return { count: branches.length };
	},
});

// ---------------------------------------------------------------------------
// Step 2: Fetch pull requests CHUNK (paginated — processes PAGES_PER_CHUNK
// pages then returns cursor for next chunk)
// ---------------------------------------------------------------------------

export const fetchPullRequestsChunk = internalAction({
	args: {
		repositoryId: v.number(),
		fullName: v.string(),
		/** Stringified page number for this chunk, or null to start from page 1. */
		cursor: v.union(v.string(), v.null()),
		...tokenArgs,
	},
	returns: v.object({
		count: v.number(),
		/** The next page number as string, or null if all pages exhausted. */
		nextCursor: v.union(v.string(), v.null()),
	}),
	handler: async (
		ctx,
		args,
	): Promise<{
		count: number;
		nextCursor: string | null;
	}> => {
		const { collectUser, getUsers } = createUserCollector();
		const [owner, repo] = splitFullName(args.fullName);
		let totalCount = 0;

		const gh = await resolveGitHubClient(ctx, toTokenArgs(args));

		let currentPage = args.cursor ? Number.parseInt(args.cursor, 10) : 1;
		let pagesProcessed = 0;
		let nextCursor: string | null = null;

		while (pagesProcessed < PAGES_PER_CHUNK) {
			const { items: page, skipped } = await Effect.runPromise(
				fetchArrayLenient(
					PullRequestSimple,
					HttpClientRequest.get(`/repos/${owner}/${repo}/pulls`).pipe(
						HttpClientRequest.setUrlParams({
							state: "all",
							per_page: 100,
							page: currentPage,
						}),
					),
				).pipe(Effect.provideService(GitHubApiClient, gh), Effect.orDie),
			);

			// Dead-letter items that failed to parse
			if (skipped.length > 0) {
				console.warn(
					`[fetchPullRequestsChunk] ${args.fullName} page ${currentPage}: skipped ${skipped.length} items due to parse errors`,
				);
				await ctx.runMutation(internal.rpc.bootstrapWrite.deadLetterBatch, {
					items: skipped.map((item) => ({
						deliveryId: `bootstrap-pr:${args.repositoryId}:page${currentPage}:idx${item.index}`,
						reason: item.error,
						payloadJson: item.raw,
					})),
				});
			}

			// Transform the page
			const pullRequests = page.map((pr) => {
				const authorUserId = pr.user ? collectUser(pr.user) : null;
				const labelNames = pr.labels.map((label) => label.name);

				return {
					githubPrId: pr.id,
					number: pr.number,
					state: toOpenClosedState(pr.state),
					draft: pr.draft ?? false,
					title: pr.title,
					body: pr.body,
					authorUserId,
					assigneeUserIds: [],
					requestedReviewerUserIds: [],
					labelNames,
					baseRefName: pr.base.ref,
					headRefName: pr.head.ref,
					headSha: pr.head.sha,
					mergeableState: null,
					mergedAt: isoToMs(pr.merged_at),
					closedAt: isoToMs(pr.closed_at),
					githubUpdatedAt: isoToMs(pr.updated_at) ?? Date.now(),
				};
			});

			// Write this page's PRs to the DB immediately (batches of 50).
			for (let i = 0; i < pullRequests.length; i += 50) {
				await ctx.runMutation(internal.rpc.bootstrapWrite.upsertPullRequests, {
					repositoryId: args.repositoryId,
					pullRequests: pullRequests.slice(i, i + 50),
					skipProjections: true,
				});
			}

			// Total count includes skipped items for pagination purposes
			const pageTotal = page.length + skipped.length;
			totalCount += page.length;
			pagesProcessed++;

			// If we got a full page, there might be more
			if (pageTotal === 100) {
				currentPage++;
				nextCursor = String(currentPage);
			} else {
				// Partial or empty page — we're done
				nextCursor = null;
				break;
			}
		}

		// Write collected users (accumulated across pages in this chunk)
		await writeUsers(ctx, getUsers());

		return { count: totalCount, nextCursor };
	},
});

// ---------------------------------------------------------------------------
// Step 3: Fetch issues CHUNK (paginated — same chunking strategy as PRs)
// ---------------------------------------------------------------------------

export const fetchIssuesChunk = internalAction({
	args: {
		repositoryId: v.number(),
		fullName: v.string(),
		/** Stringified page number for this chunk, or null to start from page 1. */
		cursor: v.union(v.string(), v.null()),
		...tokenArgs,
	},
	returns: v.object({
		count: v.number(),
		/** The next page number as string, or null if all pages exhausted. */
		nextCursor: v.union(v.string(), v.null()),
	}),
	handler: async (
		ctx,
		args,
	): Promise<{
		count: number;
		nextCursor: string | null;
	}> => {
		const { collectUser, getUsers } = createUserCollector();
		const [owner, repo] = splitFullName(args.fullName);
		let totalCount = 0;

		const gh = await resolveGitHubClient(ctx, toTokenArgs(args));

		let currentPage = args.cursor ? Number.parseInt(args.cursor, 10) : 1;
		let pagesProcessed = 0;
		let nextCursor: string | null = null;

		while (pagesProcessed < PAGES_PER_CHUNK) {
			const { items: pageItems, skipped } = await Effect.runPromise(
				fetchArrayLenient(
					Issue,
					HttpClientRequest.get(`/repos/${owner}/${repo}/issues`).pipe(
						HttpClientRequest.setUrlParams({
							state: "all",
							per_page: 100,
							page: currentPage,
						}),
					),
				).pipe(Effect.provideService(GitHubApiClient, gh), Effect.orDie),
			);

			// Dead-letter items that failed to parse
			if (skipped.length > 0) {
				console.warn(
					`[fetchIssuesChunk] ${args.fullName} page ${currentPage}: skipped ${skipped.length} items due to parse errors`,
				);
				await ctx.runMutation(internal.rpc.bootstrapWrite.deadLetterBatch, {
					items: skipped.map((item) => ({
						deliveryId: `bootstrap-issue:${args.repositoryId}:page${currentPage}:idx${item.index}`,
						reason: item.error,
						payloadJson: item.raw,
					})),
				});
			}

			// GitHub's issues API includes PRs — filter them out, then transform
			const issues = pageItems
				.filter((item) => item.pull_request == null)
				.map((issue) => {
					const authorUserId = issue.user ? collectUser(issue.user) : null;
					const labels: Array<string> = [];
					for (const l of issue.labels) {
						if (typeof l === "string") {
							labels.push(l);
						} else if (l.name != null) {
							labels.push(l.name);
						}
					}

					return {
						githubIssueId: issue.id,
						number: issue.number,
						state: toOpenClosedState(issue.state),
						title: issue.title,
						body: issue.body ?? null,
						authorUserId,
						assigneeUserIds: [],
						labelNames: labels,
						commentCount: issue.comments,
						isPullRequest: false,
						closedAt: isoToMs(issue.closed_at),
						githubUpdatedAt: isoToMs(issue.updated_at) ?? Date.now(),
					};
				});

			// Write this page's issues to the DB immediately.
			for (let i = 0; i < issues.length; i += 50) {
				await ctx.runMutation(internal.rpc.bootstrapWrite.upsertIssues, {
					repositoryId: args.repositoryId,
					issues: issues.slice(i, i + 50),
					skipProjections: true,
				});
			}

			// Total count includes skipped items for pagination purposes
			const pageTotal = pageItems.length + skipped.length;
			totalCount += issues.length;
			pagesProcessed++;

			// If we got a full page, there might be more
			if (pageTotal === 100) {
				currentPage++;
				nextCursor = String(currentPage);
			} else {
				nextCursor = null;
				break;
			}
		}

		// Write collected users
		await writeUsers(ctx, getUsers());

		return { count: totalCount, nextCursor };
	},
});

// ---------------------------------------------------------------------------
// Step 4: Fetch recent commits (first page only)
// ---------------------------------------------------------------------------

export const fetchCommits = internalAction({
	args: {
		repositoryId: v.number(),
		fullName: v.string(),
		...tokenArgs,
	},
	returns: v.object({ count: v.number() }),
	handler: async (ctx, args): Promise<{ count: number }> => {
		const { collectUser, getUsers } = createUserCollector();
		const [owner, repo] = splitFullName(args.fullName);

		const allCommits = await runWithGitHub(
			ctx,
			toTokenArgs(args),
			Effect.gen(function* () {
				const gh = yield* GitHubApiClient;
				return yield* gh.client
					.reposListCommits(owner, repo, { per_page: 100 })
					.pipe(
						// GitHub returns 409 for empty repos ("Git Repository is empty.")
						// Treat as zero commits rather than crashing.
						Effect.catchIf(
							(e) => e._tag === "BasicError" && e.response.status === 409,
							() => Effect.succeed([]),
						),
						Effect.orDie,
					);
			}),
		);

		const commits = allCommits.map((c) => {
			// c.author is NullOr(Union(SimpleUser, EmptyObject))
			// EmptyObject has no `id`/`login`, so check before collecting
			const authorUserId =
				c.author !== null && "id" in c.author ? collectUser(c.author) : null;
			const committerUserId =
				c.committer !== null && "id" in c.committer
					? collectUser(c.committer)
					: null;
			const message = c.commit.message;

			return {
				sha: c.sha,
				authorUserId,
				committerUserId,
				messageHeadline: message.split("\n")[0] ?? "",
				authoredAt: isoToMs(c.commit.author?.date ?? null),
				committedAt: isoToMs(c.commit.committer?.date ?? null),
				additions: null,
				deletions: null,
				changedFiles: null,
			};
		});

		// Write commits in batches
		for (let i = 0; i < commits.length; i += 50) {
			await ctx.runMutation(internal.rpc.bootstrapWrite.upsertCommits, {
				repositoryId: args.repositoryId,
				commits: commits.slice(i, i + 50),
			});
		}

		// Write collected users
		await writeUsers(ctx, getUsers());

		return { count: commits.length };
	},
});

// ---------------------------------------------------------------------------
// Step 5: Fetch check runs for active PR head SHAs
//
// Reads open PRs from the DB (written by fetchPullRequestsChunk) rather
// than accepting them via the workflow journal.
// ---------------------------------------------------------------------------

/**
 * Fetch check runs for a **chunk** of head SHAs. The workflow calls this
 * in a loop, passing ~100 SHAs per chunk, so each action stays well within
 * the Convex 10-minute timeout.
 */
export const fetchCheckRunsChunk = internalAction({
	args: {
		repositoryId: v.number(),
		fullName: v.string(),
		headShas: v.array(v.string()),
		...tokenArgs,
	},
	returns: v.object({ count: v.number() }),
	handler: async (ctx, args): Promise<{ count: number }> => {
		const [owner, repo] = splitFullName(args.fullName);

		const gh = await resolveGitHubClient(ctx, toTokenArgs(args));

		const allCheckRuns: Array<{
			githubCheckRunId: number;
			name: string;
			headSha: string;
			status: string;
			conclusion: string | null;
			startedAt: number | null;
			completedAt: number | null;
		}> = [];

		for (const sha of args.headShas) {
			const data = await Effect.runPromise(
				gh.client
					.checksListForRef(owner, repo, sha, { per_page: 100 })
					.pipe(Effect.orDie),
			);

			for (const cr of data.check_runs) {
				allCheckRuns.push({
					githubCheckRunId: cr.id,
					name: cr.name,
					headSha: cr.head_sha,
					status: cr.status,
					conclusion: cr.conclusion,
					startedAt: isoToMs(cr.started_at),
					completedAt: isoToMs(cr.completed_at),
				});
			}
		}

		// Write check runs in batches
		for (let i = 0; i < allCheckRuns.length; i += 50) {
			await ctx.runMutation(internal.rpc.bootstrapWrite.upsertCheckRuns, {
				repositoryId: args.repositoryId,
				checkRuns: allCheckRuns.slice(i, i + 50),
			});
		}

		return { count: allCheckRuns.length };
	},
});

// ---------------------------------------------------------------------------
// Step 6: Fetch workflow runs + jobs
// ---------------------------------------------------------------------------

export const fetchWorkflowRuns = internalAction({
	args: {
		repositoryId: v.number(),
		fullName: v.string(),
		...tokenArgs,
	},
	returns: v.object({
		runCount: v.number(),
		jobCount: v.number(),
	}),
	handler: async (
		ctx,
		args,
	): Promise<{ runCount: number; jobCount: number }> => {
		const { collectUser, getUsers } = createUserCollector();
		const [owner, repo] = splitFullName(args.fullName);

		const gh = await resolveGitHubClient(ctx, toTokenArgs(args));

		// --- Fetch workflow runs ---
		const runsData = await Effect.runPromise(
			gh.client
				.actionsListWorkflowRunsForRepo(owner, repo, { per_page: 100 })
				.pipe(Effect.orDie),
		);

		const workflowRuns = runsData.workflow_runs.map((r) => {
			const actorUserId = r.actor ? collectUser(r.actor) : null;
			return {
				githubRunId: r.id,
				workflowId: r.workflow_id,
				workflowName: r.name ?? null,
				runNumber: r.run_number,
				runAttempt: r.run_attempt ?? 1,
				event: r.event,
				status: r.status,
				conclusion: r.conclusion,
				headBranch: r.head_branch,
				headSha: r.head_sha,
				actorUserId,
				htmlUrl: r.html_url,
				createdAt: isoToMs(r.created_at) ?? Date.now(),
				updatedAt: isoToMs(r.updated_at) ?? Date.now(),
			};
		});

		// --- Fetch jobs for recent/active workflow runs ---
		const activeRunIds = workflowRuns
			.filter(
				(r) =>
					r.status === "in_progress" ||
					r.status === "queued" ||
					r.conclusion !== null,
			)
			.slice(0, 20)
			.map((r) => r.githubRunId);

		const allWorkflowJobs: Array<{
			githubJobId: number;
			githubRunId: number;
			name: string;
			status: string;
			conclusion: string | null;
			startedAt: number | null;
			completedAt: number | null;
			runnerName: string | null;
			stepsJson: string | null;
		}> = [];

		for (const runId of activeRunIds) {
			const jobsData = await Effect.runPromise(
				gh.client
					.actionsListJobsForWorkflowRun(owner, repo, String(runId), {
						per_page: 100,
					})
					.pipe(Effect.orDie),
			);

			for (const j of jobsData.jobs) {
				allWorkflowJobs.push({
					githubJobId: j.id,
					githubRunId: j.run_id,
					name: j.name,
					status: j.status,
					conclusion: j.conclusion,
					startedAt: isoToMs(j.started_at),
					completedAt: isoToMs(j.completed_at),
					runnerName: j.runner_name,
					stepsJson: j.steps ? JSON.stringify(j.steps) : null,
				});
			}
		}

		// Write workflow runs in batches
		for (let i = 0; i < workflowRuns.length; i += 50) {
			await ctx.runMutation(internal.rpc.bootstrapWrite.upsertWorkflowRuns, {
				repositoryId: args.repositoryId,
				workflowRuns: workflowRuns.slice(i, i + 50),
			});
		}

		// Write workflow jobs in batches
		for (let i = 0; i < allWorkflowJobs.length; i += 50) {
			await ctx.runMutation(internal.rpc.bootstrapWrite.upsertWorkflowJobs, {
				repositoryId: args.repositoryId,
				workflowJobs: allWorkflowJobs.slice(i, i + 50),
			});
		}

		// Write collected users
		await writeUsers(ctx, getUsers());

		return {
			runCount: workflowRuns.length,
			jobCount: allWorkflowJobs.length,
		};
	},
});

// ---------------------------------------------------------------------------
// Step 7: Read open PRs from DB and schedule PR file syncs
// ---------------------------------------------------------------------------

export const schedulePrFileSyncs = internalAction({
	args: {
		repositoryId: v.number(),
		fullName: v.string(),
		openPrSyncTargets: v.array(
			v.object({
				pullRequestNumber: v.number(),
				headSha: v.string(),
			}),
		),
		...tokenArgs,
	},
	returns: v.object({ scheduled: v.number() }),
	handler: async (ctx, args): Promise<{ scheduled: number }> => {
		const [ownerLogin, repoName] = args.fullName.split("/");
		if (!ownerLogin || !repoName) return { scheduled: 0 };

		for (const pr of args.openPrSyncTargets) {
			await ctx.scheduler.runAfter(0, internal.rpc.githubActions.syncPrFiles, {
				ownerLogin,
				name: repoName,
				repositoryId: args.repositoryId,
				pullRequestNumber: pr.pullRequestNumber,
				headSha: pr.headSha,
				installationId: args.installationId,
			});
		}

		return { scheduled: args.openPrSyncTargets.length };
	},
});

// ---------------------------------------------------------------------------
// Helper action: read open PR sync targets from the DB.
// Called by the workflow to get headShas for check-runs and file-sync steps.
// ---------------------------------------------------------------------------

export const getOpenPrSyncTargets = internalAction({
	args: {
		repositoryId: v.number(),
		...tokenArgs,
	},
	returns: v.array(
		v.object({
			pullRequestNumber: v.number(),
			headSha: v.string(),
		}),
	),
	handler: async (
		ctx,
		args,
	): Promise<Array<{ pullRequestNumber: number; headSha: string }>> => {
		// Query open PRs from the database (they were written by fetchPullRequestsChunk)
		const openPrs = await ctx.runQuery(
			internal.rpc.bootstrapWorkflow.queryOpenPrSyncTargets,
			{ repositoryId: args.repositoryId },
		);
		return openPrs;
	},
});
