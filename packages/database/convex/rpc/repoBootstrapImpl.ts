/**
 * repoBootstrapImpl — IMPLEMENTATION ONLY.
 *
 * This file provides the handler implementation for the bootstrapRepo action.
 * It imports `internal` from `_generated/api` to call internal mutations, but
 * because it exports NO Convex functions, `api.d.ts` won't deeply resolve its
 * types — breaking the circular dependency chain.
 *
 * Imported as a side-effect from `repoBootstrap.ts` to wire up `.implement()`
 * at module load time.
 */
import { Effect } from "effect";
import { internal } from "../_generated/api";
import { ConfectActionCtx } from "../confect";
import type {
	Issue,
	PullRequestSimple,
	SimpleUser,
} from "../shared/generated_github_client";
import { GitHubApiClient } from "../shared/githubApi";
import { lookupGitHubTokenByUserIdConfect } from "../shared/githubToken";
import { bootstrapRepoDef } from "./repoBootstrap";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const isoToMs = (v: string | null | undefined): number | null => {
	if (v == null) return null;
	const ms = new Date(v).getTime();
	return Number.isNaN(ms) ? null : ms;
};

// ---------------------------------------------------------------------------
// User collector type
// ---------------------------------------------------------------------------

type CollectableUser = Pick<
	typeof SimpleUser.Type,
	"id" | "login" | "avatar_url" | "site_admin" | "type"
>;

// ---------------------------------------------------------------------------
// Handler implementation
// ---------------------------------------------------------------------------

bootstrapRepoDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		// Split owner/repo early
		const [owner = "", repo = ""] = args.fullName.split("/");

		// Resolve the GitHub token from the connected user
		const token = yield* lookupGitHubTokenByUserIdConfect(
			ctx.runQuery,
			args.connectedByUserId,
		).pipe(Effect.orDie);
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		// Mark job as running
		yield* ctx.runMutation(internal.rpc.bootstrapWrite.updateSyncJobState, {
			lockKey: args.lockKey,
			state: "running",
			lastError: null,
		});

		const result = yield* Effect.gen(function* () {
			// --- User collector ---
			const userMap = new Map<number, CollectableUser>();

			const collectUser = (
				u: CollectableUser | null | undefined,
			): number | null => {
				if (u == null) return null;
				if (!userMap.has(u.id)) {
					userMap.set(u.id, {
						id: u.id,
						login: u.login,
						avatar_url: u.avatar_url,
						site_admin: u.site_admin,
						type: u.type,
					});
				}
				return u.id;
			};

			// --- Fetch branches ---
			const rawBranches = yield* gh.client.reposListBranches(owner, repo, {
				per_page: 100,
			});

			const branches = rawBranches.map((b) => ({
				name: b.name,
				headSha: b.commit.sha,
				protected: b.protected,
			}));

			yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertBranches, {
				repositoryId: args.githubRepoId,
				branches,
			});

			// --- Fetch pull requests (paginated) ---
			const allPrs: Array<PullRequestSimple> = [];
			let prPage = 1;
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
			while (true) {
				const rawPrPage = yield* gh.client.pullsList(owner, repo, {
					state: "all",
					per_page: 100,
					page: prPage,
				});
				allPrs.push(...rawPrPage);
				if (rawPrPage.length < 100) break;
				prPage++;
			}

			const pullRequests = allPrs.map((pr) => {
				const authorUserId = collectUser(pr.user);

				return {
					githubPrId: pr.id,
					number: pr.number,
					state: (pr.state === "open" ? "open" : "closed") as "open" | "closed",
					draft: pr.draft ?? false,
					title: pr.title,
					body: pr.body,
					authorUserId,
					assigneeUserIds: [] as Array<number>,
					requestedReviewerUserIds: [] as Array<number>,
					baseRefName: pr.base.ref,
					headRefName: pr.head.ref,
					headSha: pr.head.sha,
					mergeableState: null as string | null,
					mergedAt: isoToMs(pr.merged_at),
					closedAt: isoToMs(pr.closed_at),
					githubUpdatedAt: isoToMs(pr.updated_at) ?? Date.now(),
				};
			});

			// Write PRs in batches of 50 to stay within Convex mutation limits
			for (let i = 0; i < pullRequests.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertPullRequests, {
					repositoryId: args.githubRepoId,
					pullRequests: pullRequests.slice(i, i + 50),
				});
			}

			// --- Fetch issues (paginated, excludes PRs) ---
			const allIssues: Array<typeof Issue.Type> = [];
			let issuePage = 1;
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
			while (true) {
				const rawIssueResult = yield* gh.client.issuesListForRepo(owner, repo, {
					state: "all",
					per_page: 100,
					page: issuePage,
				});
				// issuesListForRepo returns IssuesListForRepo200 | BasicError union.
				// IssuesListForRepo200 extends S.Array(...) so it's array-like.
				if (!Array.isArray(rawIssueResult)) break;
				const rawIssuePage = rawIssueResult;
				// GitHub's issues API includes PRs — filter them out
				const issuesOnly = rawIssuePage.filter(
					(item) => item.pull_request == null,
				);
				allIssues.push(...issuesOnly);
				if (rawIssuePage.length < 100) break;
				issuePage++;
			}

			const issues = allIssues.map((issue) => {
				const authorUserId = collectUser(issue.user);
				const labels = issue.labels
					.map((l) => (typeof l === "string" ? l : (l.name ?? null)))
					.filter((n): n is string => n !== null);

				return {
					githubIssueId: issue.id,
					number: issue.number,
					state: (issue.state === "open" ? "open" : "closed") as
						| "open"
						| "closed",
					title: issue.title,
					body: issue.body ?? null,
					authorUserId,
					assigneeUserIds: [] as Array<number>,
					labelNames: labels,
					commentCount: issue.comments,
					isPullRequest: false,
					closedAt: isoToMs(issue.closed_at),
					githubUpdatedAt: isoToMs(issue.updated_at) ?? Date.now(),
				};
			});

			// Write issues in batches
			for (let i = 0; i < issues.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertIssues, {
					repositoryId: args.githubRepoId,
					issues: issues.slice(i, i + 50),
				});
			}

			// --- Fetch recent commits (default branch, last 100) ---
			const rawCommits = yield* gh.client.reposListCommits(owner, repo, {
				per_page: 100,
			});

			const commits = rawCommits.map((c) => {
				// Collect top-level author/committer users (GitHub user objects)
				// c.author is NullOr(Union(SimpleUser, EmptyObject)) — check for "id" in
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
					authoredAt: isoToMs(c.commit.author?.date),
					committedAt: isoToMs(c.commit.committer?.date),
					additions: null as number | null,
					deletions: null as number | null,
					changedFiles: null as number | null,
				};
			});

			// Write commits in batches
			for (let i = 0; i < commits.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertCommits, {
					repositoryId: args.githubRepoId,
					commits: commits.slice(i, i + 50),
				});
			}

			// --- Fetch check runs for active PR head SHAs ---
			const activePrHeadShas = pullRequests
				.filter((pr) => pr.state === "open" && pr.headSha !== "")
				.map((pr) => pr.headSha);

			// Deduplicate SHAs
			const uniqueShas = [...new Set(activePrHeadShas)];

			const allCheckRuns: Array<{
				githubCheckRunId: number;
				name: string;
				headSha: string;
				status: string;
				conclusion: string | null;
				startedAt: number | null;
				completedAt: number | null;
			}> = [];

			for (const sha of uniqueShas) {
				const checkResult = yield* gh.client.checksListForRef(
					owner,
					repo,
					sha,
					{ per_page: 100 },
				);
				for (const cr of checkResult.check_runs) {
					allCheckRuns.push({
						githubCheckRunId: cr.id,
						name: cr.name,
						headSha: sha,
						status: cr.status,
						conclusion: cr.conclusion,
						startedAt: isoToMs(cr.started_at),
						completedAt: isoToMs(cr.completed_at),
					});
				}
			}

			// Write check runs in batches
			for (let i = 0; i < allCheckRuns.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertCheckRuns, {
					repositoryId: args.githubRepoId,
					checkRuns: allCheckRuns.slice(i, i + 50),
				});
			}

			// --- Fetch recent workflow runs (last 100) ---
			const workflowRunsResult =
				yield* gh.client.actionsListWorkflowRunsForRepo(owner, repo, {
					per_page: 100,
				});

			const allWorkflowRuns = workflowRunsResult.workflow_runs.map((r) => {
				const actorUserId = collectUser(r.actor);
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

			// Write workflow runs in batches
			for (let i = 0; i < allWorkflowRuns.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertWorkflowRuns, {
					repositoryId: args.githubRepoId,
					workflowRuns: allWorkflowRuns.slice(i, i + 50),
				});
			}

			// --- Fetch jobs for in-progress/recent workflow runs ---
			const activeRunIds = allWorkflowRuns
				.filter(
					(r) =>
						r.status === "in_progress" ||
						r.status === "queued" ||
						r.conclusion !== null,
				)
				.slice(0, 20) // Limit API calls — only fetch jobs for the 20 most recent
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
				const jobsResult = yield* gh.client.actionsListJobsForWorkflowRun(
					owner,
					repo,
					String(runId),
					{ per_page: 100 },
				);
				for (const job of jobsResult.jobs) {
					allWorkflowJobs.push({
						githubJobId: job.id,
						githubRunId: runId,
						name: job.name,
						status: job.status,
						conclusion: job.conclusion,
						startedAt: isoToMs(job.started_at),
						completedAt: isoToMs(job.completed_at),
						runnerName: job.runner_name,
						stepsJson: JSON.stringify(job.steps ?? null),
					});
				}
			}

			// Write workflow jobs in batches
			for (let i = 0; i < allWorkflowJobs.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertWorkflowJobs, {
					repositoryId: args.githubRepoId,
					workflowJobs: allWorkflowJobs.slice(i, i + 50),
				});
			}

			// --- Upsert collected users ---
			const users = [...userMap.values()].map((u) => ({
				githubUserId: u.id,
				login: u.login,
				avatarUrl: u.avatar_url,
				siteAdmin: u.site_admin,
				type: (u.type === "Bot"
					? "Bot"
					: u.type === "Organization"
						? "Organization"
						: "User") as "User" | "Bot" | "Organization",
			}));
			if (users.length > 0) {
				for (let i = 0; i < users.length; i += 50) {
					yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertUsers, {
						users: users.slice(i, i + 50),
					});
				}
			}

			// Collect open PR info for file sync scheduling
			const openPrSyncTargets = pullRequests
				.filter((pr) => pr.state === "open" && pr.headSha !== "")
				.map((pr) => ({
					pullRequestNumber: pr.number,
					headSha: pr.headSha,
				}));

			return {
				branches: branches.length,
				pullRequests: pullRequests.length,
				issues: issues.length,
				commits: commits.length,
				checkRuns: allCheckRuns.length,
				workflowRuns: allWorkflowRuns.length,
				workflowJobs: allWorkflowJobs.length,
				users: users.length,
				openPrSyncTargets,
			};
		}).pipe(
			// On failure, mark job as failed, then promote error to defect
			// so it doesn't appear in the typed error channel (the sync job
			// state already captures the failure details).
			Effect.tapError((error) =>
				ctx
					.runMutation(internal.rpc.bootstrapWrite.updateSyncJobState, {
						lockKey: args.lockKey,
						state: "failed",
						lastError: String(error),
					})
					.pipe(Effect.ignoreLogged),
			),
			Effect.orDie,
		);

		// Schedule file syncs for open PRs so diffs are available immediately
		if (owner && repo) {
			for (const pr of result.openPrSyncTargets) {
				yield* Effect.promise(() =>
					ctx.scheduler.runAfter(0, internal.rpc.githubActions.syncPrFiles, {
						ownerLogin: owner,
						name: repo,
						repositoryId: args.githubRepoId,
						pullRequestNumber: pr.pullRequestNumber,
						headSha: pr.headSha,
						connectedByUserId: args.connectedByUserId,
						installationId: 0,
					}),
				);
			}
		}

		// Mark job as done
		yield* ctx.runMutation(internal.rpc.bootstrapWrite.updateSyncJobState, {
			lockKey: args.lockKey,
			state: "done",
			lastError: null,
		});

		return result;
	}),
);
