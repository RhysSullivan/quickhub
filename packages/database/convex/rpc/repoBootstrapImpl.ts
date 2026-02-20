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
import { GitHubApiClient, GitHubApiError } from "../shared/githubApi";
import { lookupGitHubTokenByUserIdConfect } from "../shared/githubToken";
import { bootstrapRepoDef } from "./repoBootstrap";

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
// Handler implementation
// ---------------------------------------------------------------------------

bootstrapRepoDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

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
			// --- Fetch branches ---
			const rawBranches = yield* gh.use(async (fetch) => {
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

			const branches = rawBranches.map((b) => ({
				name: str(b.name) ?? "unknown",
				headSha:
					str(
						typeof b.commit === "object" &&
							b.commit !== null &&
							"sha" in b.commit
							? b.commit.sha
							: null,
					) ?? "",
				protected: b.protected === true,
			}));

			yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertBranches, {
				repositoryId: args.githubRepoId,
				branches,
			});

			// --- Fetch pull requests (paginated) ---
			const allPrs: Array<Record<string, unknown>> = [];
			yield* gh.use(async (fetch) => {
				let url: string | null =
					`/repos/${args.fullName}/pulls?state=all&per_page=100`;
				while (url) {
					const res = await fetch(url);
					if (!res.ok)
						throw new GitHubApiError({
							status: res.status,
							message: await res.text(),
							url: res.url,
						});
					const page = (await res.json()) as Array<Record<string, unknown>>;
					allPrs.push(...page);
					url = parseNextLink(res.headers.get("Link"));
				}
			});

			// Collect unique users from PRs
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

			const collectUser = (u: unknown) => {
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

			const pullRequests = allPrs.map((pr) => {
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

			// Write PRs in batches of 50 to stay within Convex mutation limits
			for (let i = 0; i < pullRequests.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertPullRequests, {
					repositoryId: args.githubRepoId,
					pullRequests: pullRequests.slice(i, i + 50),
				});
			}

			// --- Fetch issues (paginated, excludes PRs) ---
			const allIssues: Array<Record<string, unknown>> = [];
			yield* gh.use(async (fetch) => {
				let url: string | null =
					`/repos/${args.fullName}/issues?state=all&per_page=100`;
				while (url) {
					const res = await fetch(url);
					if (!res.ok)
						throw new GitHubApiError({
							status: res.status,
							message: await res.text(),
							url: res.url,
						});
					const page = (await res.json()) as Array<Record<string, unknown>>;
					// GitHub's issues API includes PRs — filter them out
					allIssues.push(...page.filter((item) => !("pull_request" in item)));
					url = parseNextLink(res.headers.get("Link"));
				}
			});

			const issues = allIssues.map((issue) => {
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

			// Write issues in batches
			for (let i = 0; i < issues.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertIssues, {
					repositoryId: args.githubRepoId,
					issues: issues.slice(i, i + 50),
				});
			}

			// --- Fetch recent commits (default branch, last 100) ---
			const allCommits: Array<Record<string, unknown>> = [];
			yield* gh.use(async (fetch) => {
				const url: string | null =
					`/repos/${args.fullName}/commits?per_page=100`;
				const res = await fetch(url);
				if (!res.ok)
					throw new GitHubApiError({
						status: res.status,
						message: await res.text(),
						url: res.url,
					});
				const page = (await res.json()) as Array<Record<string, unknown>>;
				allCommits.push(...page);
				// Only fetch first page for bootstrap — reconciliation handles the rest
			});

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

				// Collect top-level author/committer users (GitHub user objects)
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
				yield* gh.use(async (fetch) => {
					const res = await fetch(
						`/repos/${args.fullName}/commits/${sha}/check-runs?per_page=100`,
					);
					if (!res.ok) {
						// Non-critical — some repos may not have check runs enabled
						if (res.status === 404) return;
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
					for (const cr of checkRuns) {
						const crObj =
							typeof cr === "object" && cr !== null
								? (cr as Record<string, unknown>)
								: {};
						const id = num(crObj.id);
						const name = str(crObj.name);
						if (id !== null && name !== null) {
							allCheckRuns.push({
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
				});
			}

			// Write check runs in batches
			for (let i = 0; i < allCheckRuns.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertCheckRuns, {
					repositoryId: args.githubRepoId,
					checkRuns: allCheckRuns.slice(i, i + 50),
				});
			}

			// --- Fetch recent workflow runs (last 100) ---
			const allWorkflowRuns: Array<{
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
			}> = [];

			yield* gh.use(async (fetch) => {
				const res = await fetch(
					`/repos/${args.fullName}/actions/runs?per_page=100`,
				);
				if (!res.ok) {
					// Non-critical — some repos may not use Actions
					if (res.status === 404) return;
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
				for (const r of runs) {
					const rObj =
						typeof r === "object" && r !== null
							? (r as Record<string, unknown>)
							: {};
					const id = num(rObj.id);
					const workflowId = num(rObj.workflow_id);
					const runNumber = num(rObj.run_number);
					if (id !== null && workflowId !== null && runNumber !== null) {
						const actorUserId = collectUser(rObj.actor);
						allWorkflowRuns.push({
							githubRunId: id,
							workflowId,
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
				yield* gh.use(async (fetch) => {
					const res = await fetch(
						`/repos/${args.fullName}/actions/runs/${runId}/jobs?per_page=100`,
					);
					if (!res.ok) {
						if (res.status === 404) return;
						throw new GitHubApiError({
							status: res.status,
							message: await res.text(),
							url: res.url,
						});
					}
					const data = (await res.json()) as Record<string, unknown>;
					const jobs = Array.isArray(data.jobs) ? data.jobs : [];
					for (const j of jobs) {
						const jObj =
							typeof j === "object" && j !== null
								? (j as Record<string, unknown>)
								: {};
						const jobId = num(jObj.id);
						const name = str(jObj.name);
						if (jobId !== null && name !== null) {
							allWorkflowJobs.push({
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
				});
			}

			// Write workflow jobs in batches
			for (let i = 0; i < allWorkflowJobs.length; i += 50) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertWorkflowJobs, {
					repositoryId: args.githubRepoId,
					workflowJobs: allWorkflowJobs.slice(i, i + 50),
				});
			}

			// --- Upsert collected users ---
			const users = [...userMap.values()];
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
		const [ownerLogin, repoName] = args.fullName.split("/");
		if (ownerLogin && repoName) {
			for (const pr of result.openPrSyncTargets) {
				yield* Effect.promise(() =>
					ctx.scheduler.runAfter(0, internal.rpc.githubActions.syncPrFiles, {
						ownerLogin,
						name: repoName,
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
