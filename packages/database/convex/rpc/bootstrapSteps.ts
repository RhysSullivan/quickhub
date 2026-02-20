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

import { v } from "convex/values";
import { Effect } from "effect";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import { GitHubApiClient, GitHubApiError } from "../shared/githubApi";
import {
	lookupGitHubTokenByUserId,
	resolveRepoToken,
} from "../shared/githubToken";

// ---------------------------------------------------------------------------
// GitHub response parsing helpers
// ---------------------------------------------------------------------------

const parseNextLink = (linkHeader: string | null): string | null => {
	if (!linkHeader) return null;
	const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
	return matches?.[1] ?? null;
};

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const isoToMs = (v: unknown): number | null => {
	if (typeof v !== "string") return null;
	const ms = new Date(v).getTime();
	return Number.isNaN(ms) ? null : ms;
};

const userType = (v: unknown): "User" | "Bot" | "Organization" =>
	v === "Bot" ? "Bot" : v === "Organization" ? "Organization" : "User";

// ---------------------------------------------------------------------------
// Shared user collector
// ---------------------------------------------------------------------------

type CollectedUser = {
	githubUserId: number;
	login: string;
	avatarUrl: string | null;
	siteAdmin: boolean;
	type: "User" | "Bot" | "Organization";
};

const createUserCollector = () => {
	const userMap = new Map<number, CollectedUser>();

	const collectUser = (u: unknown): number | null => {
		if (
			u !== null &&
			u !== undefined &&
			typeof u === "object" &&
			"id" in u &&
			"login" in u
		) {
			const id = num(u.id);
			const login = str(u.login);
			if (id !== null && login !== null && !userMap.has(id)) {
				userMap.set(id, {
					githubUserId: id,
					login,
					avatarUrl: "avatar_url" in u ? str(u.avatar_url) : null,
					siteAdmin: "site_admin" in u ? u.site_admin === true : false,
					type: "type" in u ? userType(u.type) : "User",
				});
			}
			return id;
		}
		return null;
	};

	return { collectUser, getUsers: () => [...userMap.values()] };
};

// ---------------------------------------------------------------------------
// Token resolution helpers
// ---------------------------------------------------------------------------

/**
 * Auth args passed to every bootstrap step.
 * Either `connectedByUserId` (user OAuth token) or `installationId` (App token)
 * or both — `resolveRepoToken` tries user first, then falls back to App.
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
const writeUsers = async (ctx: ActionCtx, users: Array<CollectedUser>) => {
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
 * Every step accepts these so the workflow can pass either a user token
 * or an installation token (or both — the resolver tries user first).
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
		const rawBranches = await runWithGitHub(
			ctx,
			toTokenArgs(args),
			Effect.gen(function* () {
				const gh = yield* GitHubApiClient;
				return yield* gh.use(async (fetch) => {
					const res = await fetch(
						`/repos/${args.fullName}/branches?per_page=100`,
					);
					if (!res.ok)
						throw new GitHubApiError({
							status: res.status,
							message: await res.text(),
							url: res.url,
						});
					return (await res.json()) as Array<Record<string, unknown>>;
				});
			}).pipe(Effect.orDie),
		);

		const branches = rawBranches.map((b) => ({
			name: str(b.name) ?? "unknown",
			headSha:
				str(
					typeof b.commit === "object" && b.commit !== null && "sha" in b.commit
						? b.commit.sha
						: null,
				) ?? "",
			protected: b.protected === true,
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
		/** The GitHub API URL for this chunk, or null to start from page 1. */
		cursor: v.union(v.string(), v.null()),
		...tokenArgs,
	},
	returns: v.object({
		count: v.number(),
		/** The next GitHub API URL, or null if all pages exhausted. */
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
		let totalCount = 0;

		const gh = await resolveGitHubClient(ctx, toTokenArgs(args));

		let url: string | null =
			args.cursor ?? `/repos/${args.fullName}/pulls?state=all&per_page=100`;

		let pagesProcessed = 0;
		let nextCursor: string | null = null;

		while (url && pagesProcessed < PAGES_PER_CHUNK) {
			// Fetch one page
			const { page, nextUrl } = await Effect.runPromise(
				gh
					.use(async (fetch) => {
						const res = await fetch(url!);
						if (!res.ok)
							throw new GitHubApiError({
								status: res.status,
								message: await res.text(),
								url: res.url,
							});
						return {
							page: (await res.json()) as Array<Record<string, unknown>>,
							nextUrl: parseNextLink(res.headers.get("Link")),
						};
					})
					.pipe(Effect.orDie),
			);

			// Transform the page
			const pullRequests = page.map((pr) => {
				const authorUserId = collectUser(pr.user);
				const head =
					typeof pr.head === "object" && pr.head !== null
						? (pr.head as Record<string, unknown>)
						: {};
				const base =
					typeof pr.base === "object" && pr.base !== null
						? (pr.base as Record<string, unknown>)
						: {};

				return {
					githubPrId: num(pr.id) ?? 0,
					number: num(pr.number) ?? 0,
					state: (pr.state === "open" ? "open" : "closed") as "open" | "closed",
					draft: pr.draft === true,
					title: str(pr.title) ?? "",
					body: str(pr.body),
					authorUserId,
					assigneeUserIds: [] as Array<number>,
					requestedReviewerUserIds: [] as Array<number>,
					baseRefName: str(base.ref) ?? "",
					headRefName: str(head.ref) ?? "",
					headSha: str(head.sha) ?? "",
					mergeableState: str(pr.mergeable_state),
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
				});
			}

			totalCount += pullRequests.length;
			pagesProcessed++;
			nextCursor = nextUrl;
			url = nextUrl;
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
		/** The GitHub API URL for this chunk, or null to start from page 1. */
		cursor: v.union(v.string(), v.null()),
		...tokenArgs,
	},
	returns: v.object({
		count: v.number(),
		/** The next GitHub API URL, or null if all pages exhausted. */
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
		let totalCount = 0;

		const gh = await resolveGitHubClient(ctx, toTokenArgs(args));

		let url: string | null =
			args.cursor ?? `/repos/${args.fullName}/issues?state=all&per_page=100`;

		let pagesProcessed = 0;
		let nextCursor: string | null = null;

		while (url && pagesProcessed < PAGES_PER_CHUNK) {
			// Fetch one page
			const { page, nextUrl } = await Effect.runPromise(
				gh
					.use(async (fetch) => {
						const res = await fetch(url!);
						if (!res.ok)
							throw new GitHubApiError({
								status: res.status,
								message: await res.text(),
								url: res.url,
							});
						return {
							page: (await res.json()) as Array<Record<string, unknown>>,
							nextUrl: parseNextLink(res.headers.get("Link")),
						};
					})
					.pipe(Effect.orDie),
			);

			// GitHub's issues API includes PRs — filter them out, then transform
			const issues = page
				.filter((item) => !("pull_request" in item))
				.map((issue) => {
					const authorUserId = collectUser(issue.user);
					const labels = Array.isArray(issue.labels)
						? issue.labels
								.map((l: unknown) =>
									typeof l === "object" &&
									l !== null &&
									"name" in l &&
									typeof l.name === "string"
										? l.name
										: null,
								)
								.filter((n: string | null): n is string => n !== null)
						: [];

					return {
						githubIssueId: num(issue.id) ?? 0,
						number: num(issue.number) ?? 0,
						state: (issue.state === "open" ? "open" : "closed") as
							| "open"
							| "closed",
						title: str(issue.title) ?? "",
						body: str(issue.body),
						authorUserId,
						assigneeUserIds: [] as Array<number>,
						labelNames: labels,
						commentCount: num(issue.comments) ?? 0,
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
				});
			}

			totalCount += issues.length;
			pagesProcessed++;
			nextCursor = nextUrl;
			url = nextUrl;
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

		const allCommits = await runWithGitHub(
			ctx,
			toTokenArgs(args),
			Effect.gen(function* () {
				const gh = yield* GitHubApiClient;
				return yield* gh.use(async (fetch) => {
					const res = await fetch(
						`/repos/${args.fullName}/commits?per_page=100`,
					);
					if (!res.ok)
						throw new GitHubApiError({
							status: res.status,
							message: await res.text(),
							url: res.url,
						});
					return (await res.json()) as Array<Record<string, unknown>>;
				});
			}).pipe(Effect.orDie),
		);

		const commits = allCommits.map((c) => {
			const commit =
				typeof c.commit === "object" && c.commit !== null
					? (c.commit as Record<string, unknown>)
					: {};
			const author =
				typeof commit.author === "object" && commit.author !== null
					? (commit.author as Record<string, unknown>)
					: {};
			const committer =
				typeof commit.committer === "object" && commit.committer !== null
					? (commit.committer as Record<string, unknown>)
					: {};

			const authorUserId = collectUser(c.author);
			const committerUserId = collectUser(c.committer);
			const message = str(commit.message) ?? "";

			return {
				sha: str(c.sha) ?? "",
				authorUserId,
				committerUserId,
				messageHeadline: message.split("\n")[0] ?? "",
				authoredAt: isoToMs(author.date),
				committedAt: isoToMs(committer.date),
				additions: null as number | null,
				deletions: null as number | null,
				changedFiles: null as number | null,
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
		const allCheckRuns = await runWithGitHub(
			ctx,
			toTokenArgs(args),
			Effect.gen(function* () {
				const gh = yield* GitHubApiClient;
				const results: Array<{
					githubCheckRunId: number;
					name: string;
					headSha: string;
					status: string;
					conclusion: string | null;
					startedAt: number | null;
					completedAt: number | null;
				}> = [];

				for (const sha of args.headShas) {
					const shaCheckRuns = yield* gh.use(async (fetch) => {
						const res = await fetch(
							`/repos/${args.fullName}/commits/${sha}/check-runs?per_page=100`,
						);
						if (!res.ok) {
							// Non-critical — some repos may not have check runs
							if (res.status === 404)
								return [] as Array<{
									githubCheckRunId: number;
									name: string;
									headSha: string;
									status: string;
									conclusion: string | null;
									startedAt: number | null;
									completedAt: number | null;
								}>;
							throw new GitHubApiError({
								status: res.status,
								message: await res.text(),
								url: res.url,
							});
						}
						const data = (await res.json()) as Record<string, unknown>;
						const checkRuns = Array.isArray(data.check_runs)
							? data.check_runs
							: [];
						const parsed: Array<{
							githubCheckRunId: number;
							name: string;
							headSha: string;
							status: string;
							conclusion: string | null;
							startedAt: number | null;
							completedAt: number | null;
						}> = [];
						for (const cr of checkRuns) {
							const crObj =
								typeof cr === "object" && cr !== null
									? (cr as Record<string, unknown>)
									: {};
							const id = num(crObj.id);
							const name = str(crObj.name);
							if (id !== null && name !== null) {
								parsed.push({
									githubCheckRunId: id,
									name,
									headSha: sha,
									status: str(crObj.status) ?? "queued",
									conclusion: str(crObj.conclusion),
									startedAt: isoToMs(crObj.started_at),
									completedAt: isoToMs(crObj.completed_at),
								});
							}
						}
						return parsed;
					});
					results.push(...shaCheckRuns);
				}
				return results;
			}).pipe(Effect.orDie),
		);

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

		const { workflowRuns, workflowJobs } = await runWithGitHub(
			ctx,
			toTokenArgs(args),
			Effect.gen(function* () {
				const gh = yield* GitHubApiClient;

				// --- Fetch workflow runs ---
				type WfRun = {
					githubRunId: number;
					workflowId: number;
					workflowName: string | null;
					runNumber: number;
					runAttempt: number;
					event: string;
					status: string | null;
					conclusion: string | null;
					headBranch: string | null;
					headSha: string;
					actorUserId: number | null;
					htmlUrl: string | null;
					createdAt: number;
					updatedAt: number;
				};

				const allWorkflowRuns: Array<WfRun> = yield* gh.use(async (fetch) => {
					const res = await fetch(
						`/repos/${args.fullName}/actions/runs?per_page=100`,
					);
					if (!res.ok) {
						if (res.status === 404) return [];
						throw new GitHubApiError({
							status: res.status,
							message: await res.text(),
							url: res.url,
						});
					}
					const data = (await res.json()) as Record<string, unknown>;
					const runs = Array.isArray(data.workflow_runs)
						? data.workflow_runs
						: [];
					const parsed: Array<WfRun> = [];
					for (const r of runs) {
						const rObj =
							typeof r === "object" && r !== null
								? (r as Record<string, unknown>)
								: {};
						const id = num(rObj.id);
						const wfId = num(rObj.workflow_id);
						const runNumber = num(rObj.run_number);
						if (id !== null && wfId !== null && runNumber !== null) {
							const actorUserId = collectUser(rObj.actor);
							parsed.push({
								githubRunId: id,
								workflowId: wfId,
								workflowName: str(rObj.name),
								runNumber,
								runAttempt: num(rObj.run_attempt) ?? 1,
								event: str(rObj.event) ?? "unknown",
								status: str(rObj.status),
								conclusion: str(rObj.conclusion),
								headBranch: str(rObj.head_branch),
								headSha: str(rObj.head_sha) ?? "",
								actorUserId,
								htmlUrl: str(rObj.html_url),
								createdAt: isoToMs(rObj.created_at) ?? Date.now(),
								updatedAt: isoToMs(rObj.updated_at) ?? Date.now(),
							});
						}
					}
					return parsed;
				});

				// --- Fetch jobs for recent/active workflow runs ---
				const activeRunIds = allWorkflowRuns
					.filter(
						(r) =>
							r.status === "in_progress" ||
							r.status === "queued" ||
							r.conclusion !== null,
					)
					.slice(0, 20)
					.map((r) => r.githubRunId);

				type WfJob = {
					githubJobId: number;
					githubRunId: number;
					name: string;
					status: string;
					conclusion: string | null;
					startedAt: number | null;
					completedAt: number | null;
					runnerName: string | null;
					stepsJson: string | null;
				};

				const allWorkflowJobs: Array<WfJob> = [];

				for (const runId of activeRunIds) {
					const jobs = yield* gh.use(async (fetch) => {
						const res = await fetch(
							`/repos/${args.fullName}/actions/runs/${runId}/jobs?per_page=100`,
						);
						if (!res.ok) {
							if (res.status === 404) return [] as Array<WfJob>;
							throw new GitHubApiError({
								status: res.status,
								message: await res.text(),
								url: res.url,
							});
						}
						const data = (await res.json()) as Record<string, unknown>;
						const jobsList = Array.isArray(data.jobs) ? data.jobs : [];
						const parsed: Array<WfJob> = [];
						for (const j of jobsList) {
							const jObj =
								typeof j === "object" && j !== null
									? (j as Record<string, unknown>)
									: {};
							const jobId = num(jObj.id);
							const name = str(jObj.name);
							if (jobId !== null && name !== null) {
								parsed.push({
									githubJobId: jobId,
									githubRunId: runId,
									name,
									status: str(jObj.status) ?? "queued",
									conclusion: str(jObj.conclusion),
									startedAt: isoToMs(jObj.started_at),
									completedAt: isoToMs(jObj.completed_at),
									runnerName: str(jObj.runner_name),
									stepsJson: Array.isArray(jObj.steps)
										? JSON.stringify(jObj.steps)
										: null,
								});
							}
						}
						return parsed;
					});
					allWorkflowJobs.push(...jobs);
				}

				return {
					workflowRuns: allWorkflowRuns,
					workflowJobs: allWorkflowJobs,
				};
			}).pipe(Effect.orDie),
		);

		// Write workflow runs in batches
		for (let i = 0; i < workflowRuns.length; i += 50) {
			await ctx.runMutation(internal.rpc.bootstrapWrite.upsertWorkflowRuns, {
				repositoryId: args.repositoryId,
				workflowRuns: workflowRuns.slice(i, i + 50),
			});
		}

		// Write workflow jobs in batches
		for (let i = 0; i < workflowJobs.length; i += 50) {
			await ctx.runMutation(internal.rpc.bootstrapWrite.upsertWorkflowJobs, {
				repositoryId: args.repositoryId,
				workflowJobs: workflowJobs.slice(i, i + 50),
			});
		}

		// Write collected users
		await writeUsers(ctx, getUsers());

		return {
			runCount: workflowRuns.length,
			jobCount: workflowJobs.length,
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
				connectedByUserId: args.connectedByUserId,
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
