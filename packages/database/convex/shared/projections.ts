/**
 * Projection builders — update denormalized view tables from normalized domain data.
 *
 * These functions run within mutation context to keep projections consistent
 * with the normalized tables in the same transaction.
 *
 * Two flavours:
 *
 * 1. **Incremental** (`upsertPullRequestView`, `upsertIssueView`, etc.)
 *    Touch a single view row for a single entity. O(1) per call — safe to
 *    call inside per-batch upsert mutations during bootstrap and webhook
 *    processing.
 *
 * 2. **Full rebuild** (`rebuildPullRequestList`, `rebuildIssueList`, etc.)
 *    Delete-all + re-insert for a repo. Only called during `repairProjections`
 *    (cron) — runs on bounded page sizes to stay within mutation limits.
 *
 * Counting uses `@convex-dev/aggregate` for O(log n) lookups instead of
 * scanning entire tables. The aggregates are defined in `./aggregates.ts`.
 */
import { Effect, Option } from "effect";
import { ConfectMutationCtx } from "../confect";
import {
	checkRunsByRepo,
	commentsByIssueNumber,
	issuesByRepo,
	jobsByWorkflowRun,
	prsByRepo,
	reviewsByPrNumber,
} from "./aggregates";

// ---------------------------------------------------------------------------
// view_repo_overview — per-repo counters + quick status
//
// Uses O(log n) aggregate counts. No more bounded .take() scans.
// ---------------------------------------------------------------------------

export const updateRepoOverview = (repositoryId: number) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		const rawCtx = ctx.rawCtx;

		// Get the repository record for metadata
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) => q.eq("githubRepoId", repositoryId))
			.first();

		if (Option.isNone(repo)) return;

		const repoDoc = repo.value;

		// O(log n) aggregate counts
		const openPrCount = yield* Effect.promise(() =>
			prsByRepo.count(rawCtx, {
				namespace: repositoryId,
				bounds: {
					lower: { key: "open", inclusive: true },
					upper: { key: "open", inclusive: true },
				},
			}),
		);

		const openIssueCount = yield* Effect.promise(() =>
			issuesByRepo.count(rawCtx, {
				namespace: repositoryId,
				bounds: {
					lower: { key: "open", inclusive: true },
					upper: { key: "open", inclusive: true },
				},
			}),
		);

		// For failing checks: count total, then subtract non-failing.
		// Non-failing conclusions: null (in progress), "success", "skipped", "neutral"
		// We use countBatch for efficiency.
		const checkCounts = yield* Effect.promise(() =>
			checkRunsByRepo.countBatch(rawCtx, [
				{ namespace: repositoryId },
				{
					namespace: repositoryId,
					bounds: {
						lower: { key: "success", inclusive: true },
						upper: { key: "success", inclusive: true },
					},
				},
				{
					namespace: repositoryId,
					bounds: {
						lower: { key: "skipped", inclusive: true },
						upper: { key: "skipped", inclusive: true },
					},
				},
				{
					namespace: repositoryId,
					bounds: {
						lower: { key: "neutral", inclusive: true },
						upper: { key: "neutral", inclusive: true },
					},
				},
				{
					namespace: repositoryId,
					bounds: {
						lower: { key: null, inclusive: true },
						upper: { key: null, inclusive: true },
					},
				},
			]),
		);

		const totalChecks = checkCounts[0] ?? 0;
		const successChecks = checkCounts[1] ?? 0;
		const skippedChecks = checkCounts[2] ?? 0;
		const neutralChecks = checkCounts[3] ?? 0;
		const nullChecks = checkCounts[4] ?? 0;
		const failingCheckCount =
			totalChecks - successChecks - skippedChecks - neutralChecks - nullChecks;

		const data = {
			repositoryId,
			fullName: repoDoc.fullName,
			ownerLogin: repoDoc.ownerLogin,
			name: repoDoc.name,
			openPrCount,
			openIssueCount,
			failingCheckCount: Math.max(0, failingCheckCount),
			lastPushAt: repoDoc.pushedAt,
			syncLagSeconds: null as number | null,
			updatedAt: now,
		};

		// Upsert the overview row
		const existing = yield* ctx.db
			.query("view_repo_overview")
			.withIndex("by_repositoryId", (q) => q.eq("repositoryId", repositoryId))
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, data);
		} else {
			yield* ctx.db.insert("view_repo_overview", data);
		}
	});

// ---------------------------------------------------------------------------
// Incremental PR view upsert — touch ONE view row for ONE pull request
// ---------------------------------------------------------------------------

export const upsertPullRequestView = (
	repositoryId: number,
	pr: {
		githubPrId: number;
		number: number;
		state: "open" | "closed";
		draft: boolean;
		title: string;
		authorUserId: number | null;
		headRefName: string;
		baseRefName: string;
		headSha: string;
		githubUpdatedAt: number;
	},
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const rawCtx = ctx.rawCtx;

		// Look up author
		let authorLogin: string | null = null;
		let authorAvatarUrl: string | null = null;
		if (pr.authorUserId !== null) {
			const user = yield* ctx.db
				.query("github_users")
				.withIndex("by_githubUserId", (q) =>
					q.eq("githubUserId", pr.authorUserId!),
				)
				.first();
			if (Option.isSome(user)) {
				authorLogin = user.value.login;
				authorAvatarUrl = user.value.avatarUrl;
			}
		}

		// O(log n) aggregate counts for comments and reviews
		const commentCount = yield* Effect.promise(() =>
			commentsByIssueNumber.count(rawCtx, {
				namespace: `${repositoryId}:${pr.number}`,
			}),
		);

		const reviewCount = yield* Effect.promise(() =>
			reviewsByPrNumber.count(rawCtx, {
				namespace: `${repositoryId}:${pr.number}`,
			}),
		);

		// Get latest check conclusion for this PR's head SHA
		// (This is a small bounded read — typically <50 check runs per SHA)
		const checkRuns = yield* ctx.db
			.query("github_check_runs")
			.withIndex("by_repositoryId_and_headSha", (q) =>
				q.eq("repositoryId", repositoryId).eq("headSha", pr.headSha),
			)
			.take(200);

		let lastCheckConclusion: string | null = null;
		for (const cr of checkRuns) {
			if (
				cr.conclusion !== null &&
				cr.conclusion !== "success" &&
				cr.conclusion !== "skipped" &&
				cr.conclusion !== "neutral"
			) {
				lastCheckConclusion = cr.conclusion;
				break; // Any failing check is enough
			}
			if (lastCheckConclusion === null) {
				lastCheckConclusion = cr.conclusion;
			}
		}

		const viewData = {
			repositoryId,
			githubPrId: pr.githubPrId,
			number: pr.number,
			state: pr.state,
			draft: pr.draft,
			title: pr.title,
			authorLogin,
			authorAvatarUrl,
			headRefName: pr.headRefName,
			baseRefName: pr.baseRefName,
			commentCount,
			reviewCount,
			lastCheckConclusion,
			githubUpdatedAt: pr.githubUpdatedAt,
			sortUpdated: pr.githubUpdatedAt,
		};

		// Find existing view row by repositoryId + number
		const existing = yield* ctx.db
			.query("view_repo_pull_request_list")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId).eq("number", pr.number),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, viewData);
		} else {
			yield* ctx.db.insert("view_repo_pull_request_list", viewData);
		}
	});

// ---------------------------------------------------------------------------
// Incremental issue view upsert — touch ONE view row for ONE issue
// ---------------------------------------------------------------------------

export const upsertIssueView = (
	repositoryId: number,
	issue: {
		githubIssueId: number;
		number: number;
		state: "open" | "closed";
		title: string;
		authorUserId: number | null;
		labelNames: ReadonlyArray<string>;
		commentCount: number;
		isPullRequest: boolean;
		githubUpdatedAt: number;
	},
) =>
	Effect.gen(function* () {
		// Skip if it's actually a PR (issues API includes PRs)
		if (issue.isPullRequest) return;

		const ctx = yield* ConfectMutationCtx;

		// Look up author
		let authorLogin: string | null = null;
		let authorAvatarUrl: string | null = null;
		if (issue.authorUserId !== null) {
			const user = yield* ctx.db
				.query("github_users")
				.withIndex("by_githubUserId", (q) =>
					q.eq("githubUserId", issue.authorUserId!),
				)
				.first();
			if (Option.isSome(user)) {
				authorLogin = user.value.login;
				authorAvatarUrl = user.value.avatarUrl;
			}
		}

		const viewData = {
			repositoryId,
			githubIssueId: issue.githubIssueId,
			number: issue.number,
			state: issue.state,
			title: issue.title,
			authorLogin,
			authorAvatarUrl,
			labelNames: [...issue.labelNames],
			commentCount: issue.commentCount,
			githubUpdatedAt: issue.githubUpdatedAt,
			sortUpdated: issue.githubUpdatedAt,
		};

		const existing = yield* ctx.db
			.query("view_repo_issue_list")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId).eq("number", issue.number),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, viewData);
		} else {
			yield* ctx.db.insert("view_repo_issue_list", viewData);
		}
	});

// ---------------------------------------------------------------------------
// Incremental workflow run view upsert
// ---------------------------------------------------------------------------

export const upsertWorkflowRunView = (
	repositoryId: number,
	run: {
		githubRunId: number;
		workflowName: string | null;
		runNumber: number;
		event: string;
		status: string | null;
		conclusion: string | null;
		headBranch: string | null;
		headSha: string;
		actorUserId: number | null;
		htmlUrl: string | null;
		createdAt: number;
		updatedAt: number;
	},
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const rawCtx = ctx.rawCtx;

		// Look up actor
		let actorLogin: string | null = null;
		let actorAvatarUrl: string | null = null;
		if (run.actorUserId !== null) {
			const user = yield* ctx.db
				.query("github_users")
				.withIndex("by_githubUserId", (q) =>
					q.eq("githubUserId", run.actorUserId!),
				)
				.first();
			if (Option.isSome(user)) {
				actorLogin = user.value.login;
				actorAvatarUrl = user.value.avatarUrl;
			}
		}

		// O(log n) aggregate count for jobs
		const jobCount = yield* Effect.promise(() =>
			jobsByWorkflowRun.count(rawCtx, {
				namespace: `${repositoryId}:${run.githubRunId}`,
			}),
		);

		const viewData = {
			repositoryId,
			githubRunId: run.githubRunId,
			workflowName: run.workflowName,
			runNumber: run.runNumber,
			event: run.event,
			status: run.status,
			conclusion: run.conclusion,
			headBranch: run.headBranch,
			headSha: run.headSha,
			actorLogin,
			actorAvatarUrl,
			jobCount,
			htmlUrl: run.htmlUrl,
			createdAt: run.createdAt,
			updatedAt: run.updatedAt,
			sortUpdated: run.updatedAt,
		};

		const existing = yield* ctx.db
			.query("view_repo_workflow_run_list")
			.withIndex("by_repositoryId_and_githubRunId", (q) =>
				q.eq("repositoryId", repositoryId).eq("githubRunId", run.githubRunId),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, viewData);
		} else {
			yield* ctx.db.insert("view_repo_workflow_run_list", viewData);
		}
	});

// ---------------------------------------------------------------------------
// view_activity_feed — normalized activity events from webhook events
// ---------------------------------------------------------------------------

export const appendActivityFeedEntry = (
	repositoryId: number,
	installationId: number,
	activityType: string,
	title: string,
	description: string | null,
	actorLogin: string | null,
	actorAvatarUrl: string | null,
	entityNumber: number | null,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		yield* ctx.db.insert("view_activity_feed", {
			repositoryId,
			installationId,
			activityType,
			title,
			description,
			actorLogin,
			actorAvatarUrl,
			entityNumber,
			createdAt: Date.now(),
		});
	});

// ---------------------------------------------------------------------------
// Legacy full-rebuild functions — kept for repairProjections cron only.
//
// These do delete-all + re-insert for an entire repo. They are ONLY called
// from the periodic repair cron (every 5 min) and process a bounded page
// at a time to stay within mutation time limits.
// ---------------------------------------------------------------------------

/** Full rebuild of the PR list view for a repo. */
export const rebuildPullRequestList = (repositoryId: number) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		// Delete existing view rows (bounded — delete in chunks)
		const existingViews = yield* ctx.db
			.query("view_repo_pull_request_list")
			.withIndex("by_repositoryId_and_sortUpdated", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.take(5000);

		for (const v of existingViews) {
			yield* ctx.db.delete(v._id);
		}

		// Re-insert from normalized data (bounded)
		const prs = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.take(5000);

		for (const pr of prs) {
			yield* upsertPullRequestView(repositoryId, pr);
		}
	});

/** Full rebuild of the issue list view for a repo. */
export const rebuildIssueList = (repositoryId: number) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		const existingViews = yield* ctx.db
			.query("view_repo_issue_list")
			.withIndex("by_repositoryId_and_sortUpdated", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.take(5000);

		for (const v of existingViews) {
			yield* ctx.db.delete(v._id);
		}

		const issues = yield* ctx.db
			.query("github_issues")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.take(5000);

		for (const issue of issues) {
			if (!issue.isPullRequest) {
				yield* upsertIssueView(repositoryId, issue);
			}
		}
	});

/** Full rebuild of the workflow run list view for a repo. */
export const rebuildWorkflowRunList = (repositoryId: number) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		const existingViews = yield* ctx.db
			.query("view_repo_workflow_run_list")
			.withIndex("by_repositoryId_and_sortUpdated", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.take(5000);

		for (const v of existingViews) {
			yield* ctx.db.delete(v._id);
		}

		const runs = yield* ctx.db
			.query("github_workflow_runs")
			.withIndex("by_repositoryId_and_updatedAt", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.take(5000);

		for (const run of runs) {
			yield* upsertWorkflowRunView(repositoryId, run);
		}
	});

// ---------------------------------------------------------------------------
// Combined projection update — for repairProjections cron and bootstrap end
//
// Uses the full-rebuild approach, bounded at 5000 per table. For repos
// with > 5000 entities, subsequent cron runs will catch the remainder.
// ---------------------------------------------------------------------------

export const updateAllProjections = (repositoryId: number) =>
	Effect.gen(function* () {
		yield* updateRepoOverview(repositoryId);
		yield* rebuildPullRequestList(repositoryId);
		yield* rebuildIssueList(repositoryId);
		yield* rebuildWorkflowRunList(repositoryId);
		// Activity feed is append-only — handled separately per event
	});

// Re-export legacy names for backward compatibility with existing callers
export const updatePullRequestList = rebuildPullRequestList;
export const updateIssueList = rebuildIssueList;
export const updateWorkflowRunList = rebuildWorkflowRunList;
