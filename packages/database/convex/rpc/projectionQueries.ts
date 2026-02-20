import {
	Cursor,
	PaginationOptionsSchema,
	PaginationResultSchema,
} from "@packages/confect";
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { components, internal } from "../_generated/api";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";
import {
	checkRunsByRepo,
	commentsByIssueNumber,
	issuesByRepo,
	jobsByWorkflowRun,
	prsByRepo,
	reviewsByPrNumber,
} from "../shared/aggregates";
import { resolveRepoAccess } from "../shared/permissions";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

/**
 * Get all connected repositories with their overview stats.
 */
const listReposDef = factory.query({
	success: Schema.Array(
		Schema.Struct({
			repositoryId: Schema.Number,
			fullName: Schema.String,
			ownerLogin: Schema.String,
			name: Schema.String,
			openPrCount: Schema.Number,
			openIssueCount: Schema.Number,
			failingCheckCount: Schema.Number,
			lastPushAt: Schema.NullOr(Schema.Number),
			updatedAt: Schema.Number,
		}),
	),
});

/**
 * Get a single repo overview by owner/name.
 */
const getRepoOverviewDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
	},
	success: Schema.NullOr(
		Schema.Struct({
			repositoryId: Schema.Number,
			fullName: Schema.String,
			ownerLogin: Schema.String,
			name: Schema.String,
			openPrCount: Schema.Number,
			openIssueCount: Schema.Number,
			failingCheckCount: Schema.Number,
			lastPushAt: Schema.NullOr(Schema.Number),
			updatedAt: Schema.Number,
		}),
	),
});

/**
 * Get pull request list for a repository.
 */
const listPullRequestsDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		state: Schema.optional(Schema.Literal("open", "closed")),
	},
	success: Schema.Array(
		Schema.Struct({
			number: Schema.Number,
			state: Schema.Literal("open", "closed"),
			draft: Schema.Boolean,
			title: Schema.String,
			authorLogin: Schema.NullOr(Schema.String),
			authorAvatarUrl: Schema.NullOr(Schema.String),
			headRefName: Schema.String,
			baseRefName: Schema.String,
			commentCount: Schema.Number,
			reviewCount: Schema.Number,
			lastCheckConclusion: Schema.NullOr(Schema.String),
			githubUpdatedAt: Schema.Number,
		}),
	),
});

/**
 * Get issue list for a repository.
 */
const listIssuesDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		state: Schema.optional(Schema.Literal("open", "closed")),
	},
	success: Schema.Array(
		Schema.Struct({
			number: Schema.Number,
			state: Schema.Literal("open", "closed"),
			title: Schema.String,
			authorLogin: Schema.NullOr(Schema.String),
			authorAvatarUrl: Schema.NullOr(Schema.String),
			labelNames: Schema.Array(Schema.String),
			commentCount: Schema.Number,
			githubUpdatedAt: Schema.Number,
		}),
	),
});

/**
 * Get activity feed for a repository.
 */
const listActivityDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		limit: Schema.optional(Schema.Number),
	},
	success: Schema.Array(
		Schema.Struct({
			activityType: Schema.String,
			title: Schema.String,
			description: Schema.NullOr(Schema.String),
			actorLogin: Schema.NullOr(Schema.String),
			actorAvatarUrl: Schema.NullOr(Schema.String),
			entityNumber: Schema.NullOr(Schema.Number),
			createdAt: Schema.Number,
		}),
	),
});

/**
 * Get files changed in a pull request (for diff view).
 * Returns files for the given PR, optionally filtered by headSha.
 * If no headSha is given, returns the most recently cached set.
 */
const listPrFilesDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		number: Schema.Number,
		headSha: Schema.optional(Schema.String),
	},
	success: Schema.Struct({
		headSha: Schema.NullOr(Schema.String),
		files: Schema.Array(
			Schema.Struct({
				filename: Schema.String,
				status: Schema.Literal(
					"added",
					"removed",
					"modified",
					"renamed",
					"copied",
					"changed",
					"unchanged",
				),
				additions: Schema.Number,
				deletions: Schema.Number,
				changes: Schema.Number,
				patch: Schema.NullOr(Schema.String),
				previousFilename: Schema.NullOr(Schema.String),
			}),
		),
	}),
});

/**
 * Request on-demand PR file sync.
 *
 * When a user opens a PR detail page and we have no cached files for it,
 * this mutation schedules a background `syncPrFiles` action to fetch
 * the file list + patches from GitHub.
 *
 * Idempotent: if files already exist for the PR's current headSha,
 * no sync is scheduled.
 */
const requestPrFileSyncDef = factory.mutation({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		number: Schema.Number,
	},
	success: Schema.Struct({
		scheduled: Schema.Boolean,
	}),
});

// ---------------------------------------------------------------------------
// Paginated list endpoint definitions
// ---------------------------------------------------------------------------

const PrListItem = Schema.Struct({
	number: Schema.Number,
	state: Schema.Literal("open", "closed"),
	draft: Schema.Boolean,
	title: Schema.String,
	authorLogin: Schema.NullOr(Schema.String),
	authorAvatarUrl: Schema.NullOr(Schema.String),
	headRefName: Schema.String,
	baseRefName: Schema.String,
	commentCount: Schema.Number,
	reviewCount: Schema.Number,
	lastCheckConclusion: Schema.NullOr(Schema.String),
	githubUpdatedAt: Schema.Number,
});

const IssueListItem = Schema.Struct({
	number: Schema.Number,
	state: Schema.Literal("open", "closed"),
	title: Schema.String,
	authorLogin: Schema.NullOr(Schema.String),
	authorAvatarUrl: Schema.NullOr(Schema.String),
	labelNames: Schema.Array(Schema.String),
	commentCount: Schema.Number,
	githubUpdatedAt: Schema.Number,
});

const ActivityListItem = Schema.Struct({
	activityType: Schema.String,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	actorLogin: Schema.NullOr(Schema.String),
	actorAvatarUrl: Schema.NullOr(Schema.String),
	entityNumber: Schema.NullOr(Schema.Number),
	createdAt: Schema.Number,
});

/**
 * Paginated pull request list with optional state filter.
 */
const listPullRequestsPaginatedDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		state: Schema.optional(Schema.Literal("open", "closed")),
		...PaginationOptionsSchema.fields,
	},
	success: PaginationResultSchema(PrListItem),
});

/**
 * Paginated issue list with optional state filter.
 */
const listIssuesPaginatedDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		state: Schema.optional(Schema.Literal("open", "closed")),
		...PaginationOptionsSchema.fields,
	},
	success: PaginationResultSchema(IssueListItem),
});

/**
 * Paginated activity feed.
 */
const listActivityPaginatedDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		...PaginationOptionsSchema.fields,
	},
	success: PaginationResultSchema(ActivityListItem),
});

/**
 * Get workflow run list for a repository.
 */
const listWorkflowRunsDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
	},
	success: Schema.Array(
		Schema.Struct({
			githubRunId: Schema.Number,
			workflowName: Schema.NullOr(Schema.String),
			runNumber: Schema.Number,
			event: Schema.String,
			status: Schema.NullOr(Schema.String),
			conclusion: Schema.NullOr(Schema.String),
			headBranch: Schema.NullOr(Schema.String),
			headSha: Schema.String,
			actorLogin: Schema.NullOr(Schema.String),
			actorAvatarUrl: Schema.NullOr(Schema.String),
			jobCount: Schema.Number,
			htmlUrl: Schema.NullOr(Schema.String),
			createdAt: Schema.Number,
			updatedAt: Schema.Number,
		}),
	),
});

const WorkflowRunListItem = Schema.Struct({
	githubRunId: Schema.Number,
	workflowName: Schema.NullOr(Schema.String),
	runNumber: Schema.Number,
	event: Schema.String,
	status: Schema.NullOr(Schema.String),
	conclusion: Schema.NullOr(Schema.String),
	headBranch: Schema.NullOr(Schema.String),
	headSha: Schema.String,
	actorLogin: Schema.NullOr(Schema.String),
	actorAvatarUrl: Schema.NullOr(Schema.String),
	jobCount: Schema.Number,
	htmlUrl: Schema.NullOr(Schema.String),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});

/**
 * Paginated workflow run list.
 */
const listWorkflowRunsPaginatedDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		...PaginationOptionsSchema.fields,
	},
	success: PaginationResultSchema(WorkflowRunListItem),
});

const WorkflowJobSchema = Schema.Struct({
	githubJobId: Schema.Number,
	name: Schema.String,
	status: Schema.String,
	conclusion: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.Number),
	completedAt: Schema.NullOr(Schema.Number),
	runnerName: Schema.NullOr(Schema.String),
	stepsJson: Schema.NullOr(Schema.String),
});

/**
 * Get full workflow run detail including jobs.
 */
const getWorkflowRunDetailDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		runNumber: Schema.Number,
	},
	success: Schema.NullOr(
		Schema.Struct({
			repositoryId: Schema.Number,
			githubRunId: Schema.Number,
			workflowName: Schema.NullOr(Schema.String),
			runNumber: Schema.Number,
			runAttempt: Schema.Number,
			event: Schema.String,
			status: Schema.NullOr(Schema.String),
			conclusion: Schema.NullOr(Schema.String),
			headBranch: Schema.NullOr(Schema.String),
			headSha: Schema.String,
			actorLogin: Schema.NullOr(Schema.String),
			actorAvatarUrl: Schema.NullOr(Schema.String),
			htmlUrl: Schema.NullOr(Schema.String),
			createdAt: Schema.Number,
			updatedAt: Schema.Number,
			jobs: Schema.Array(WorkflowJobSchema),
		}),
	),
});

// -- Shared sub-schemas for detail views ------------------------------------

const CommentSchema = Schema.Struct({
	githubCommentId: Schema.Number,
	authorLogin: Schema.NullOr(Schema.String),
	authorAvatarUrl: Schema.NullOr(Schema.String),
	body: Schema.String,
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});

const ReviewSchema = Schema.Struct({
	githubReviewId: Schema.Number,
	authorLogin: Schema.NullOr(Schema.String),
	authorAvatarUrl: Schema.NullOr(Schema.String),
	state: Schema.String,
	submittedAt: Schema.NullOr(Schema.Number),
});

const ReviewCommentSchema = Schema.Struct({
	githubReviewCommentId: Schema.Number,
	githubReviewId: Schema.NullOr(Schema.Number),
	inReplyToGithubReviewCommentId: Schema.NullOr(Schema.Number),
	authorLogin: Schema.NullOr(Schema.String),
	authorAvatarUrl: Schema.NullOr(Schema.String),
	body: Schema.String,
	path: Schema.NullOr(Schema.String),
	line: Schema.NullOr(Schema.Number),
	startLine: Schema.NullOr(Schema.Number),
	side: Schema.NullOr(Schema.String),
	startSide: Schema.NullOr(Schema.String),
	htmlUrl: Schema.NullOr(Schema.String),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});

const CheckRunSchema = Schema.Struct({
	githubCheckRunId: Schema.Number,
	name: Schema.String,
	status: Schema.String,
	conclusion: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.Number),
	completedAt: Schema.NullOr(Schema.Number),
});

/**
 * Get full issue detail including body and comments.
 */
const getIssueDetailDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		number: Schema.Number,
	},
	success: Schema.NullOr(
		Schema.Struct({
			repositoryId: Schema.Number,
			number: Schema.Number,
			state: Schema.Literal("open", "closed"),
			title: Schema.String,
			body: Schema.NullOr(Schema.String),
			authorLogin: Schema.NullOr(Schema.String),
			authorAvatarUrl: Schema.NullOr(Schema.String),
			labelNames: Schema.Array(Schema.String),
			commentCount: Schema.Number,
			closedAt: Schema.NullOr(Schema.Number),
			githubUpdatedAt: Schema.Number,
			comments: Schema.Array(CommentSchema),
		}),
	),
});

/**
 * Get full pull request detail including body, comments, reviews, and check runs.
 */
const getPullRequestDetailDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		number: Schema.Number,
	},
	success: Schema.NullOr(
		Schema.Struct({
			repositoryId: Schema.Number,
			number: Schema.Number,
			state: Schema.Literal("open", "closed"),
			draft: Schema.Boolean,
			title: Schema.String,
			body: Schema.NullOr(Schema.String),
			authorLogin: Schema.NullOr(Schema.String),
			authorAvatarUrl: Schema.NullOr(Schema.String),
			headRefName: Schema.String,
			baseRefName: Schema.String,
			headSha: Schema.String,
			mergeableState: Schema.NullOr(Schema.String),
			mergedAt: Schema.NullOr(Schema.Number),
			closedAt: Schema.NullOr(Schema.Number),
			githubUpdatedAt: Schema.Number,
			comments: Schema.Array(CommentSchema),
			reviews: Schema.Array(ReviewSchema),
			reviewComments: Schema.Array(ReviewCommentSchema),
			checkRuns: Schema.Array(CheckRunSchema),
		}),
	),
});

/**
 * Get bootstrap sync progress for a repository.
 * Returns the sync job's current step, completed steps, item counts,
 * and overall state so the UI can render a live progress indicator.
 *
 * Returns null if no sync job exists (repo was never synced).
 */
const getSyncProgressDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
	},
	success: Schema.NullOr(
		Schema.Struct({
			state: Schema.Literal("pending", "running", "retry", "done", "failed"),
			currentStep: Schema.NullOr(Schema.String),
			completedSteps: Schema.Array(Schema.String),
			itemsFetched: Schema.Number,
			lastError: Schema.NullOr(Schema.String),
			startedAt: Schema.Number,
			updatedAt: Schema.Number,
		}),
	),
});

// ---------------------------------------------------------------------------
// Home dashboard — cross-repo aggregate
// ---------------------------------------------------------------------------

const DashboardPrItem = Schema.Struct({
	ownerLogin: Schema.String,
	repoName: Schema.String,
	number: Schema.Number,
	state: Schema.Literal("open", "closed"),
	draft: Schema.Boolean,
	title: Schema.String,
	authorLogin: Schema.NullOr(Schema.String),
	authorAvatarUrl: Schema.NullOr(Schema.String),
	commentCount: Schema.Number,
	lastCheckConclusion: Schema.NullOr(Schema.String),
	githubUpdatedAt: Schema.Number,
});

const RecentActivityItem = Schema.Struct({
	ownerLogin: Schema.String,
	repoName: Schema.String,
	activityType: Schema.String,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	actorLogin: Schema.NullOr(Schema.String),
	actorAvatarUrl: Schema.NullOr(Schema.String),
	entityNumber: Schema.NullOr(Schema.Number),
	createdAt: Schema.Number,
});

const RepoQuickAccess = Schema.Struct({
	ownerLogin: Schema.String,
	name: Schema.String,
	fullName: Schema.String,
	openPrCount: Schema.Number,
	openIssueCount: Schema.Number,
	failingCheckCount: Schema.Number,
	lastPushAt: Schema.NullOr(Schema.Number),
});

/**
 * Get a personalized cross-repo home dashboard.
 *
 * Resolves the signed-in user's GitHub account and returns:
 * - `yourPrs`             — open PRs authored by the user across all repos
 * - `needsAttentionPrs`   — open PRs where user is assignee or requested reviewer
 * - `recentPrs`           — the most recently updated PRs across all repos
 * - `recentActivity`      — recent activity feed across all repos
 * - `repos`               — quick-access repo summaries sorted by recent push
 * - `githubLogin`         — the user's GitHub username (for display)
 */
const getHomeDashboardDef = factory.query({
	success: Schema.Struct({
		githubLogin: Schema.NullOr(Schema.String),
		yourPrs: Schema.Array(DashboardPrItem),
		needsAttentionPrs: Schema.Array(DashboardPrItem),
		recentPrs: Schema.Array(DashboardPrItem),
		recentActivity: Schema.Array(RecentActivityItem),
		repos: Schema.Array(RepoQuickAccess),
	}),
});

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

// -- Helpers for aggregate counts at query time -----------------------------

const openStateBounds = {
	lower: { key: "open", inclusive: true },
	upper: { key: "open", inclusive: true },
};

const failureConclusionBounds = {
	lower: { key: "failure", inclusive: true },
	upper: { key: "failure", inclusive: true },
};

const isMissingAggregateComponentError = (error: unknown) =>
	error instanceof Error &&
	error.message.includes('Component "') &&
	error.message.includes("is not registered");

const safeAggregateCount = (
	attempt: Effect.Effect<number, unknown>,
	fallback: Effect.Effect<number>,
) =>
	attempt.pipe(
		Effect.catchAll((error) =>
			isMissingAggregateComponentError(error) ? fallback : Effect.die(error),
		),
	);

const tryAggregateCount = (
	attempt: () => Promise<number>,
	fallback: Effect.Effect<number>,
) =>
	safeAggregateCount(
		Effect.tryPromise({
			try: attempt,
			catch: (error) => new Error(String(error)),
		}),
		fallback,
	);

/**
 * Compute overview counts for a repository using O(log n) aggregates.
 * Returns { openPrCount, openIssueCount, failingCheckCount }.
 */
const computeRepoCounts = (repositoryId: number) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const raw = ctx.rawCtx;

		const openPrCount = yield* safeAggregateCount(
			Effect.tryPromise({
				try: () =>
					prsByRepo.count(raw, {
						namespace: repositoryId,
						bounds: openStateBounds,
					}),
				catch: (error) => new Error(String(error)),
			}),
			Effect.gen(function* () {
				const openPrs = yield* ctx.db
					.query("github_pull_requests")
					.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
						q.eq("repositoryId", repositoryId).eq("state", "open"),
					)
					.collect();
				return openPrs.length;
			}),
		);

		const openIssueCount = yield* safeAggregateCount(
			Effect.tryPromise({
				try: () =>
					issuesByRepo.count(raw, {
						namespace: repositoryId,
						bounds: openStateBounds,
					}),
				catch: (error) => new Error(String(error)),
			}),
			Effect.gen(function* () {
				const openIssues = yield* ctx.db
					.query("github_issues")
					.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
						q.eq("repositoryId", repositoryId).eq("state", "open"),
					)
					.collect();
				return openIssues.length;
			}),
		);

		const failingCheckCount = yield* safeAggregateCount(
			Effect.tryPromise({
				try: () =>
					checkRunsByRepo.count(raw, {
						namespace: repositoryId,
						bounds: failureConclusionBounds,
					}),
				catch: (error) => new Error(String(error)),
			}),
			Effect.gen(function* () {
				const checkRuns = yield* ctx.db.query("github_check_runs").collect();
				return checkRuns.filter(
					(checkRun) =>
						checkRun.repositoryId === repositoryId &&
						checkRun.conclusion === "failure",
				).length;
			}),
		);

		return { openPrCount, openIssueCount, failingCheckCount };
	});

listReposDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		// Bounded — personal dashboard should have <100 repos
		const repos = yield* ctx.db.query("github_repositories").take(100);
		const results = [];
		for (const repo of repos) {
			const access = yield* resolveRepoAccess(
				repo.githubRepoId,
				repo.private,
			).pipe(Effect.either);
			if (access._tag === "Left") continue;

			const counts = yield* computeRepoCounts(repo.githubRepoId);
			results.push({
				repositoryId: repo.githubRepoId,
				fullName: repo.fullName,
				ownerLogin: repo.ownerLogin,
				name: repo.name,
				openPrCount: counts.openPrCount,
				openIssueCount: counts.openIssueCount,
				failingCheckCount: counts.failingCheckCount,
				lastPushAt: repo.pushedAt,
				updatedAt: repo.githubUpdatedAt,
			});
		}

		return results;
	}),
);

getRepoOverviewDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		// Look up repo by owner/name
		const repoOpt = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repoOpt)) return null;

		const repo = repoOpt.value;
		const access = yield* resolveRepoAccess(
			repo.githubRepoId,
			repo.private,
		).pipe(Effect.either);
		if (access._tag === "Left") return null;

		const counts = yield* computeRepoCounts(repo.githubRepoId);

		return {
			repositoryId: repo.githubRepoId,
			fullName: repo.fullName,
			ownerLogin: repo.ownerLogin,
			name: repo.name,
			openPrCount: counts.openPrCount,
			openIssueCount: counts.openIssueCount,
			failingCheckCount: counts.failingCheckCount,
			lastPushAt: repo.pushedAt,
			updatedAt: repo.githubUpdatedAt,
		};
	}),
);

getSyncProgressDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const raw = ctx.rawCtx;

		// Look up the repo to get its githubRepoId
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repo)) return null;

		const access = yield* resolveRepoAccess(
			repo.value.githubRepoId,
			repo.value.private,
		).pipe(Effect.either);
		if (access._tag === "Left") return null;

		const repositoryId = repo.value.githubRepoId;
		const installationId = repo.value.installationId;

		// Find the bootstrap sync job for this repository
		const lockKey = `repo-bootstrap:${installationId}:${repositoryId}`;
		const job = yield* ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", lockKey))
			.first();

		if (Option.isNone(job)) return null;

		// Derive itemsFetched from aggregate counts, with table-scan fallback in tests.
		const prCount = yield* tryAggregateCount(
			() => prsByRepo.count(raw, { namespace: repositoryId }),
			Effect.gen(function* () {
				const prs = yield* ctx.db
					.query("github_pull_requests")
					.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
						q.eq("repositoryId", repositoryId),
					)
					.collect();
				return prs.length;
			}),
		);

		const issueCount = yield* tryAggregateCount(
			() => issuesByRepo.count(raw, { namespace: repositoryId }),
			Effect.gen(function* () {
				const issues = yield* ctx.db
					.query("github_issues")
					.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
						q.eq("repositoryId", repositoryId),
					)
					.collect();
				return issues.length;
			}),
		);

		const checkRunCount = yield* tryAggregateCount(
			() => checkRunsByRepo.count(raw, { namespace: repositoryId }),
			Effect.gen(function* () {
				const checkRuns = yield* ctx.db.query("github_check_runs").collect();
				return checkRuns.filter(
					(checkRun) => checkRun.repositoryId === repositoryId,
				).length;
			}),
		);
		const itemsFetched = prCount + issueCount + checkRunCount;

		const j = job.value;
		return {
			state: j.state,
			currentStep: j.currentStep ?? null,
			completedSteps: [...(j.completedSteps ?? [])],
			itemsFetched,
			lastError: j.lastError,
			startedAt: j.createdAt,
			updatedAt: j.updatedAt,
		};
	}),
);

/**
 * Enrich a PR with computed counts and check conclusion.
 * Resolves author, comment count, review count, and last check conclusion
 * using the normalized tables and aggregates.
 */
const enrichPr = (pr: {
	readonly repositoryId: number;
	readonly number: number;
	readonly state: "open" | "closed";
	readonly draft: boolean;
	readonly title: string;
	readonly authorUserId: number | null;
	readonly headRefName: string;
	readonly baseRefName: string;
	readonly headSha: string;
	readonly githubUpdatedAt: number;
}) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const raw = ctx.rawCtx;
		const author = yield* resolveUser(pr.authorUserId);

		const commentCount = yield* tryAggregateCount(
			() =>
				commentsByIssueNumber.count(raw, {
					namespace: `${pr.repositoryId}:${pr.number}`,
				}),
			Effect.gen(function* () {
				const comments = yield* ctx.db
					.query("github_issue_comments")
					.withIndex("by_repositoryId_and_issueNumber", (q) =>
						q.eq("repositoryId", pr.repositoryId).eq("issueNumber", pr.number),
					)
					.collect();
				return comments.length;
			}),
		);

		const reviewCount = yield* tryAggregateCount(
			() =>
				reviewsByPrNumber.count(raw, {
					namespace: `${pr.repositoryId}:${pr.number}`,
				}),
			Effect.gen(function* () {
				const reviews = yield* ctx.db
					.query("github_pull_request_reviews")
					.withIndex("by_repositoryId_and_pullRequestNumber", (q) =>
						q
							.eq("repositoryId", pr.repositoryId)
							.eq("pullRequestNumber", pr.number),
					)
					.collect();
				return reviews.length;
			}),
		);

		// Derive lastCheckConclusion from check runs on the PR's headSha
		const checkRuns = yield* ctx.db
			.query("github_check_runs")
			.withIndex("by_repositoryId_and_headSha", (q) =>
				q.eq("repositoryId", pr.repositoryId).eq("headSha", pr.headSha),
			)
			.take(200);

		let lastCheckConclusion: string | null = null;
		if (checkRuns.length > 0) {
			const hasFailure = checkRuns.some(
				(cr) =>
					cr.conclusion === "failure" ||
					cr.conclusion === "timed_out" ||
					cr.conclusion === "action_required",
			);
			const hasPending = checkRuns.some((cr) => cr.status !== "completed");
			if (hasFailure) {
				lastCheckConclusion = "failure";
			} else if (hasPending) {
				lastCheckConclusion = null;
			} else {
				lastCheckConclusion = "success";
			}
		}

		return {
			number: pr.number,
			state: pr.state,
			draft: pr.draft,
			title: pr.title,
			authorLogin: author.login,
			authorAvatarUrl: author.avatarUrl,
			headRefName: pr.headRefName,
			baseRefName: pr.baseRefName,
			commentCount,
			reviewCount,
			lastCheckConclusion,
			githubUpdatedAt: pr.githubUpdatedAt,
		};
	});

listPullRequestsDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return [];

		const ctx = yield* ConfectQueryCtx;

		const state = args.state;
		const query =
			state !== undefined
				? ctx.db
						.query("github_pull_requests")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repositoryId).eq("state", state),
						)
						.order("desc")
				: ctx.db
						.query("github_pull_requests")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repositoryId),
						)
						.order("desc");

		// Bounded to prevent unbounded queries on large repos
		const prs = yield* query.take(200);

		return yield* Effect.all(prs.map(enrichPr), {
			concurrency: "unbounded",
		});
	}),
);

/**
 * Enrich an issue with author info resolved from github_users.
 */
const enrichIssue = (issue: {
	readonly repositoryId: number;
	readonly number: number;
	readonly state: "open" | "closed";
	readonly title: string;
	readonly authorUserId: number | null;
	readonly labelNames: ReadonlyArray<string>;
	readonly commentCount: number;
	readonly githubUpdatedAt: number;
}) =>
	Effect.gen(function* () {
		const author = yield* resolveUser(issue.authorUserId);
		return {
			number: issue.number,
			state: issue.state,
			title: issue.title,
			authorLogin: author.login,
			authorAvatarUrl: author.avatarUrl,
			labelNames: [...issue.labelNames],
			commentCount: issue.commentCount,
			githubUpdatedAt: issue.githubUpdatedAt,
		};
	});

listIssuesDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return [];

		const ctx = yield* ConfectQueryCtx;

		const state = args.state;
		const query =
			state !== undefined
				? ctx.db
						.query("github_issues")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repositoryId).eq("state", state),
						)
						.order("desc")
				: ctx.db
						.query("github_issues")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repositoryId),
						)
						.order("desc");

		// Bounded to prevent unbounded queries on large repos
		const issues = yield* query.take(200);

		return yield* Effect.all(issues.map(enrichIssue), {
			concurrency: "unbounded",
		});
	}),
);

listActivityDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repo)) return [];

		const access = yield* resolveRepoAccess(
			repo.value.githubRepoId,
			repo.value.private,
		).pipe(Effect.either);
		if (access._tag === "Left") return [];

		const repositoryId = repo.value.githubRepoId;
		const limit = args.limit ?? 50;
		const activities = yield* ctx.db
			.query("view_activity_feed")
			.withIndex("by_repositoryId_and_createdAt", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.order("desc")
			.take(limit);

		return activities.map((a) => ({
			activityType: a.activityType,
			title: a.title,
			description: a.description,
			actorLogin: a.actorLogin,
			actorAvatarUrl: a.actorAvatarUrl,
			entityNumber: a.entityNumber,
			createdAt: a.createdAt,
		}));
	}),
);

// -- Home dashboard implementation ------------------------------------------

/**
 * Resolve the signed-in user's GitHub login from their better-auth identity.
 *
 * Flow: identity.subject → account table (providerId=github) → accountId
 *       → github_users table → login
 */
const resolveViewerGitHub = Effect.gen(function* () {
	const ctx = yield* ConfectQueryCtx;

	const identity = yield* ctx.auth.getUserIdentity();
	if (Option.isNone(identity)) return null;

	// Look up the GitHub provider row in the better-auth account table
	const account: unknown = yield* ctx.runQuery(
		components.betterAuth.adapter.findOne,
		{
			model: "account" as const,
			where: [
				{ field: "providerId", value: "github" },
				{ field: "userId", value: identity.value.subject },
			],
		},
	);

	if (
		!account ||
		typeof account !== "object" ||
		!("accountId" in account) ||
		typeof account.accountId !== "string"
	) {
		return null;
	}

	const githubUserId = Number(account.accountId);
	if (Number.isNaN(githubUserId)) return null;

	// Look up the GitHub user profile from our synced table
	const githubUser = yield* ctx.db
		.query("github_users")
		.withIndex("by_githubUserId", (q) => q.eq("githubUserId", githubUserId))
		.first();

	if (Option.isNone(githubUser)) return null;
	return githubUser.value.login;
});

getHomeDashboardDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		// 0. Resolve the viewer's GitHub login
		const githubLogin = yield* resolveViewerGitHub;

		// 1. All repos (bounded to 100), sorted by most recently pushed
		const allRepos = yield* ctx.db.query("github_repositories").take(100);
		const accessibleRepos = [];
		for (const repo of allRepos) {
			const access = yield* resolveRepoAccess(
				repo.githubRepoId,
				repo.private,
			).pipe(Effect.either);
			if (access._tag === "Right") {
				accessibleRepos.push(repo);
			}
		}

		const repoOverviews = yield* Effect.all(
			accessibleRepos.map((repo) =>
				Effect.gen(function* () {
					const counts = yield* computeRepoCounts(repo.githubRepoId);
					return {
						repositoryId: repo.githubRepoId,
						ownerLogin: repo.ownerLogin,
						name: repo.name,
						fullName: repo.fullName,
						openPrCount: counts.openPrCount,
						openIssueCount: counts.openIssueCount,
						failingCheckCount: counts.failingCheckCount,
						lastPushAt: repo.pushedAt,
					};
				}),
			),
			{ concurrency: "unbounded" },
		);

		const repos = [...repoOverviews]
			.sort((a, b) => (b.lastPushAt ?? 0) - (a.lastPushAt ?? 0))
			.map((o) => ({
				ownerLogin: o.ownerLogin,
				name: o.name,
				fullName: o.fullName,
				openPrCount: o.openPrCount,
				openIssueCount: o.openIssueCount,
				failingCheckCount: o.failingCheckCount,
				lastPushAt: o.lastPushAt,
			}));

		// 2. Fetch recent open PRs across all repos from normalized table
		const allPrsByRepo = yield* Effect.all(
			accessibleRepos.map((repo) =>
				Effect.gen(function* () {
					const prs = yield* ctx.db
						.query("github_pull_requests")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repo.githubRepoId).eq("state", "open"),
						)
						.order("desc")
						.take(15);

					// Resolve author and assignee/reviewer logins for each PR
					const enriched = yield* Effect.all(
						prs.map((pr) =>
							Effect.gen(function* () {
								const author = yield* resolveUser(pr.authorUserId);

								// Resolve assignee logins
								const assigneeLogins = yield* Effect.all(
									pr.assigneeUserIds.map((uid) =>
										Effect.gen(function* () {
											const u = yield* resolveUser(uid);
											return u.login;
										}),
									),
									{ concurrency: "unbounded" },
								);

								// Resolve requested reviewer logins
								const requestedReviewerLogins = yield* Effect.all(
									pr.requestedReviewerUserIds.map((uid) =>
										Effect.gen(function* () {
											const u = yield* resolveUser(uid);
											return u.login;
										}),
									),
									{ concurrency: "unbounded" },
								);

								const raw = ctx.rawCtx;
								const commentCount = yield* tryAggregateCount(
									() =>
										commentsByIssueNumber.count(raw, {
											namespace: `${pr.repositoryId}:${pr.number}`,
										}),
									Effect.gen(function* () {
										const comments = yield* ctx.db
											.query("github_issue_comments")
											.withIndex("by_repositoryId_and_issueNumber", (q) =>
												q
													.eq("repositoryId", pr.repositoryId)
													.eq("issueNumber", pr.number),
											)
											.collect();
										return comments.length;
									}),
								);

								// Derive lastCheckConclusion
								const checkRuns = yield* ctx.db
									.query("github_check_runs")
									.withIndex("by_repositoryId_and_headSha", (q) =>
										q
											.eq("repositoryId", pr.repositoryId)
											.eq("headSha", pr.headSha),
									)
									.take(200);

								let lastCheckConclusion: string | null = null;
								if (checkRuns.length > 0) {
									const hasFailure = checkRuns.some(
										(cr) =>
											cr.conclusion === "failure" ||
											cr.conclusion === "timed_out" ||
											cr.conclusion === "action_required",
									);
									const hasPending = checkRuns.some(
										(cr) => cr.status !== "completed",
									);
									if (hasFailure) {
										lastCheckConclusion = "failure";
									} else if (hasPending) {
										lastCheckConclusion = null;
									} else {
										lastCheckConclusion = "success";
									}
								}

								return {
									ownerLogin: repo.ownerLogin,
									repoName: repo.name,
									number: pr.number,
									state: pr.state,
									draft: pr.draft,
									title: pr.title,
									authorLogin: author.login,
									authorAvatarUrl: author.avatarUrl,
									assigneeLogins: assigneeLogins.filter(
										(l): l is string => l !== null,
									),
									requestedReviewerLogins: requestedReviewerLogins.filter(
										(l): l is string => l !== null,
									),
									commentCount,
									lastCheckConclusion,
									githubUpdatedAt: pr.githubUpdatedAt,
								};
							}),
						),
						{ concurrency: "unbounded" },
					);

					return enriched;
				}),
			),
			{ concurrency: "unbounded" },
		);

		const allPrs = allPrsByRepo
			.flat()
			.sort((a, b) => b.githubUpdatedAt - a.githubUpdatedAt);

		// Split into "your PRs", "needs attention", and "other recent PRs"
		const yourPrs = githubLogin
			? allPrs.filter((pr) => pr.authorLogin === githubLogin).slice(0, 10)
			: [];

		const yourPrKeys = new Set(
			yourPrs.map((pr) => `${pr.ownerLogin}/${pr.repoName}#${pr.number}`),
		);

		const needsAttentionPrs = githubLogin
			? allPrs
					.filter((pr) => {
						if (yourPrKeys.has(`${pr.ownerLogin}/${pr.repoName}#${pr.number}`))
							return false;
						return (
							pr.assigneeLogins.includes(githubLogin) ||
							pr.requestedReviewerLogins.includes(githubLogin)
						);
					})
					.slice(0, 10)
			: [];

		const excludedKeys = new Set([
			...yourPrs.map((pr) => `${pr.ownerLogin}/${pr.repoName}#${pr.number}`),
			...needsAttentionPrs.map(
				(pr) => `${pr.ownerLogin}/${pr.repoName}#${pr.number}`,
			),
		]);
		const recentPrs = allPrs
			.filter(
				(pr) =>
					!excludedKeys.has(`${pr.ownerLogin}/${pr.repoName}#${pr.number}`),
			)
			.slice(0, 10);

		// 3. Recent activity across all repos — use activity feed
		const allRecentActivity = yield* Effect.all(
			accessibleRepos.map((repo) =>
				Effect.gen(function* () {
					const activities = yield* ctx.db
						.query("view_activity_feed")
						.withIndex("by_repositoryId_and_createdAt", (q) =>
							q.eq("repositoryId", repo.githubRepoId),
						)
						.order("desc")
						.take(5);

					return activities.map((a) => ({
						ownerLogin: repo.ownerLogin,
						repoName: repo.name,
						activityType: a.activityType,
						title: a.title,
						description: a.description,
						actorLogin: a.actorLogin,
						actorAvatarUrl: a.actorAvatarUrl,
						entityNumber: a.entityNumber,
						createdAt: a.createdAt,
					}));
				}),
			),
			{ concurrency: "unbounded" },
		);

		const recentActivity = allRecentActivity
			.flat()
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, 20);

		// Strip internal fields before returning (assigneeLogins, requestedReviewerLogins
		// are used for filtering but not exposed in DashboardPrItem)
		const toDashboardPr = (pr: (typeof allPrs)[number]) => ({
			ownerLogin: pr.ownerLogin,
			repoName: pr.repoName,
			number: pr.number,
			state: pr.state,
			draft: pr.draft,
			title: pr.title,
			authorLogin: pr.authorLogin,
			authorAvatarUrl: pr.authorAvatarUrl,
			commentCount: pr.commentCount,
			lastCheckConclusion: pr.lastCheckConclusion,
			githubUpdatedAt: pr.githubUpdatedAt,
		});

		return {
			githubLogin,
			yourPrs: yourPrs.map(toDashboardPr),
			needsAttentionPrs: needsAttentionPrs.map(toDashboardPr),
			recentPrs: recentPrs.map(toDashboardPr),
			recentActivity,
			repos,
		};
	}),
);

// -- Helper: resolve GitHub user login + avatar by userId -------------------

const resolveUser = (userId: number | null) =>
	Effect.gen(function* () {
		if (userId === null) return { login: null, avatarUrl: null };
		const ctx = yield* ConfectQueryCtx;
		const user = yield* ctx.db
			.query("github_users")
			.withIndex("by_githubUserId", (q) => q.eq("githubUserId", userId))
			.first();
		if (Option.isNone(user)) return { login: null, avatarUrl: null };
		return { login: user.value.login, avatarUrl: user.value.avatarUrl };
	});

const hasPullPermission = (permission: {
	readonly pull: boolean;
	readonly triage: boolean;
	readonly push: boolean;
	readonly maintain: boolean;
	readonly admin: boolean;
}) =>
	permission.pull ||
	permission.triage ||
	permission.push ||
	permission.maintain ||
	permission.admin;

// -- Helper: find repo by owner/name and return repositoryId ----------------

const findRepo = (ownerLogin: string, name: string) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", ownerLogin).eq("name", name),
			)
			.first();
		if (Option.isNone(repo)) return null;

		const access = yield* resolveRepoAccess(
			repo.value.githubRepoId,
			repo.value.private,
		).pipe(Effect.either);
		if (access._tag === "Left") return null;

		return repo.value.githubRepoId;
	});

getIssueDetailDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return null;

		const ctx = yield* ConfectQueryCtx;

		// Get the issue
		const issueOpt = yield* ctx.db
			.query("github_issues")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId).eq("number", args.number),
			)
			.first();

		if (Option.isNone(issueOpt)) return null;
		const issue = issueOpt.value;

		// Resolve author
		const author = yield* resolveUser(issue.authorUserId);

		// Get comments (bounded to 500 — practical limit for a single issue)
		const rawComments = yield* ctx.db
			.query("github_issue_comments")
			.withIndex("by_repositoryId_and_issueNumber", (q) =>
				q.eq("repositoryId", repositoryId).eq("issueNumber", args.number),
			)
			.take(500);

		// Resolve comment authors
		const comments = yield* Effect.all(
			rawComments.map((c) =>
				Effect.gen(function* () {
					const commentAuthor = yield* resolveUser(c.authorUserId);
					return {
						githubCommentId: c.githubCommentId,
						authorLogin: commentAuthor.login,
						authorAvatarUrl: commentAuthor.avatarUrl,
						body: c.body,
						createdAt: c.createdAt,
						updatedAt: c.updatedAt,
					};
				}),
			),
			{ concurrency: "unbounded" },
		);

		return {
			repositoryId,
			number: issue.number,
			state: issue.state,
			title: issue.title,
			body: issue.body,
			authorLogin: author.login,
			authorAvatarUrl: author.avatarUrl,
			labelNames: [...issue.labelNames],
			commentCount: issue.commentCount,
			closedAt: issue.closedAt,
			githubUpdatedAt: issue.githubUpdatedAt,
			comments,
		};
	}),
);

getPullRequestDetailDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return null;

		const ctx = yield* ConfectQueryCtx;

		// Get the pull request
		const prOpt = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId).eq("number", args.number),
			)
			.first();

		if (Option.isNone(prOpt)) return null;
		const pr = prOpt.value;

		// Resolve author
		const author = yield* resolveUser(pr.authorUserId);

		// Get comments (bounded — a PR rarely has >500 comments)
		const rawComments = yield* ctx.db
			.query("github_issue_comments")
			.withIndex("by_repositoryId_and_issueNumber", (q) =>
				q.eq("repositoryId", repositoryId).eq("issueNumber", args.number),
			)
			.take(500);

		const comments = yield* Effect.all(
			rawComments.map((c) =>
				Effect.gen(function* () {
					const commentAuthor = yield* resolveUser(c.authorUserId);
					return {
						githubCommentId: c.githubCommentId,
						authorLogin: commentAuthor.login,
						authorAvatarUrl: commentAuthor.avatarUrl,
						body: c.body,
						createdAt: c.createdAt,
						updatedAt: c.updatedAt,
					};
				}),
			),
			{ concurrency: "unbounded" },
		);

		// Get reviews (bounded — a PR rarely has >200 reviews)
		const rawReviews = yield* ctx.db
			.query("github_pull_request_reviews")
			.withIndex("by_repositoryId_and_pullRequestNumber", (q) =>
				q.eq("repositoryId", repositoryId).eq("pullRequestNumber", args.number),
			)
			.take(200);

		const reviews = yield* Effect.all(
			rawReviews.map((r) =>
				Effect.gen(function* () {
					const reviewAuthor = yield* resolveUser(r.authorUserId);
					return {
						githubReviewId: r.githubReviewId,
						authorLogin: reviewAuthor.login,
						authorAvatarUrl: reviewAuthor.avatarUrl,
						state: r.state,
						submittedAt: r.submittedAt,
					};
				}),
			),
			{ concurrency: "unbounded" },
		);

		// Get review comments (bounded — large PRs can have many inline comments)
		const rawReviewComments = yield* ctx.db
			.query("github_pull_request_review_comments")
			.withIndex("by_repositoryId_and_pullRequestNumber", (q) =>
				q.eq("repositoryId", repositoryId).eq("pullRequestNumber", args.number),
			)
			.take(500);

		const reviewComments = yield* Effect.all(
			rawReviewComments.map((r) =>
				Effect.gen(function* () {
					const reviewCommentAuthor = yield* resolveUser(r.authorUserId);
					return {
						githubReviewCommentId: r.githubReviewCommentId,
						githubReviewId: r.githubReviewId,
						inReplyToGithubReviewCommentId: r.inReplyToGithubReviewCommentId,
						authorLogin: reviewCommentAuthor.login,
						authorAvatarUrl: reviewCommentAuthor.avatarUrl,
						body: r.body,
						path: r.path,
						line: r.line,
						startLine: r.startLine,
						side: r.side,
						startSide: r.startSide,
						htmlUrl: r.htmlUrl,
						createdAt: r.createdAt,
						updatedAt: r.updatedAt,
					};
				}),
			),
			{ concurrency: "unbounded" },
		);

		// Get check runs for this PR's head SHA (bounded)
		const checkRuns = yield* ctx.db
			.query("github_check_runs")
			.withIndex("by_repositoryId_and_headSha", (q) =>
				q.eq("repositoryId", repositoryId).eq("headSha", pr.headSha),
			)
			.take(200);

		return {
			repositoryId,
			number: pr.number,
			state: pr.state,
			draft: pr.draft,
			title: pr.title,
			body: pr.body,
			authorLogin: author.login,
			authorAvatarUrl: author.avatarUrl,
			headRefName: pr.headRefName,
			baseRefName: pr.baseRefName,
			headSha: pr.headSha,
			mergeableState: pr.mergeableState,
			mergedAt: pr.mergedAt,
			closedAt: pr.closedAt,
			githubUpdatedAt: pr.githubUpdatedAt,
			comments,
			reviews,
			reviewComments,
			checkRuns: checkRuns.map((cr) => ({
				githubCheckRunId: cr.githubCheckRunId,
				name: cr.name,
				status: cr.status,
				conclusion: cr.conclusion,
				startedAt: cr.startedAt,
				completedAt: cr.completedAt,
			})),
		};
	}),
);

listPrFilesDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return { headSha: null, files: [] };

		const ctx = yield* ConfectQueryCtx;

		if (args.headSha !== undefined) {
			const sha = args.headSha;
			// Fetch files for a specific headSha
			const files = yield* ctx.db
				.query("github_pull_request_files")
				.withIndex("by_repositoryId_and_pullRequestNumber_and_headSha", (q) =>
					q
						.eq("repositoryId", repositoryId)
						.eq("pullRequestNumber", args.number)
						.eq("headSha", sha),
				)
				.collect();

			return {
				headSha: sha,
				files: files.map((f) => ({
					filename: f.filename,
					status: f.status,
					additions: f.additions,
					deletions: f.deletions,
					changes: f.changes,
					patch: f.patch,
					previousFilename: f.previousFilename,
				})),
			};
		}

		// No headSha specified — find the most recently cached set.
		// Look up the PR to get its current headSha.
		const prOpt = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId).eq("number", args.number),
			)
			.first();

		if (Option.isNone(prOpt)) return { headSha: null, files: [] };

		const headSha = prOpt.value.headSha;
		const files = yield* ctx.db
			.query("github_pull_request_files")
			.withIndex("by_repositoryId_and_pullRequestNumber_and_headSha", (q) =>
				q
					.eq("repositoryId", repositoryId)
					.eq("pullRequestNumber", args.number)
					.eq("headSha", headSha),
			)
			.collect();

		return {
			headSha,
			files: files.map((f) => ({
				filename: f.filename,
				status: f.status,
				additions: f.additions,
				deletions: f.deletions,
				changes: f.changes,
				patch: f.patch,
				previousFilename: f.previousFilename,
			})),
		};
	}),
);

// ---------------------------------------------------------------------------
// requestPrFileSync implementation
// ---------------------------------------------------------------------------

requestPrFileSyncDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		// 1. Find the repo
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repo)) return { scheduled: false };

		const repositoryId = repo.value.githubRepoId;
		const identity = yield* ctx.auth.getUserIdentity();

		if (repo.value.private) {
			if (Option.isNone(identity)) return { scheduled: false };

			const permission = yield* ctx.db
				.query("github_user_repo_permissions")
				.withIndex("by_userId_and_repositoryId", (q) =>
					q
						.eq("userId", identity.value.subject)
						.eq("repositoryId", repositoryId),
				)
				.first();

			if (Option.isNone(permission) || !hasPullPermission(permission.value)) {
				return { scheduled: false };
			}
		}

		// 2. Find the PR to get its headSha
		const prOpt = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId).eq("number", args.number),
			)
			.first();

		if (Option.isNone(prOpt)) return { scheduled: false };

		const headSha = prOpt.value.headSha;
		if (headSha === "") return { scheduled: false };

		// 3. Check if we already have files for this headSha
		const existingFile = yield* ctx.db
			.query("github_pull_request_files")
			.withIndex("by_repositoryId_and_pullRequestNumber_and_headSha", (q) =>
				q
					.eq("repositoryId", repositoryId)
					.eq("pullRequestNumber", args.number)
					.eq("headSha", headSha),
			)
			.first();

		if (Option.isSome(existingFile)) return { scheduled: false };

		// 4. No files cached — schedule a background sync
		// Use the signed-in user's token if available, otherwise fall back to installation token
		const connectedByUserId = Option.isSome(identity)
			? identity.value.subject
			: (repo.value.connectedByUserId ?? null);
		const installationId = repo.value.installationId;

		if (!connectedByUserId && installationId <= 0) return { scheduled: false };

		yield* Effect.promise(() =>
			ctx.scheduler.runAfter(0, internal.rpc.githubActions.syncPrFiles, {
				ownerLogin: args.ownerLogin,
				name: args.name,
				repositoryId,
				pullRequestNumber: args.number,
				headSha,
				connectedByUserId,
				installationId,
			}),
		);

		return { scheduled: true };
	}),
);

// ---------------------------------------------------------------------------
// Paginated list implementations
// ---------------------------------------------------------------------------

listPullRequestsPaginatedDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) {
			return {
				page: [],
				isDone: true,
				continueCursor: Cursor.make(""),
			};
		}

		const ctx = yield* ConfectQueryCtx;
		const paginationOpts = {
			cursor: args.cursor ?? null,
			numItems: args.numItems,
		};

		const state = args.state;
		const query =
			state !== undefined
				? ctx.db
						.query("github_pull_requests")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repositoryId).eq("state", state),
						)
						.order("desc")
				: ctx.db
						.query("github_pull_requests")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repositoryId),
						)
						.order("desc");

		const result = yield* query.paginate(paginationOpts);

		const page = yield* Effect.all(result.page.map(enrichPr), {
			concurrency: "unbounded",
		});

		return {
			page,
			isDone: result.isDone,
			continueCursor: Cursor.make(result.continueCursor),
		};
	}),
);

listIssuesPaginatedDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) {
			return {
				page: [],
				isDone: true,
				continueCursor: Cursor.make(""),
			};
		}

		const ctx = yield* ConfectQueryCtx;
		const paginationOpts = {
			cursor: args.cursor ?? null,
			numItems: args.numItems,
		};

		const state = args.state;
		const query =
			state !== undefined
				? ctx.db
						.query("github_issues")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repositoryId).eq("state", state),
						)
						.order("desc")
				: ctx.db
						.query("github_issues")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repositoryId),
						)
						.order("desc");

		const result = yield* query.paginate(paginationOpts);

		const page = yield* Effect.all(result.page.map(enrichIssue), {
			concurrency: "unbounded",
		});

		return {
			page,
			isDone: result.isDone,
			continueCursor: Cursor.make(result.continueCursor),
		};
	}),
);

listActivityPaginatedDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) {
			return {
				page: [],
				isDone: true,
				continueCursor: Cursor.make(""),
			};
		}

		const ctx = yield* ConfectQueryCtx;
		const paginationOpts = {
			cursor: args.cursor ?? null,
			numItems: args.numItems,
		};

		const result = yield* ctx.db
			.query("view_activity_feed")
			.withIndex("by_repositoryId_and_createdAt", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.order("desc")
			.paginate(paginationOpts);

		return {
			page: result.page.map((a) => ({
				activityType: a.activityType,
				title: a.title,
				description: a.description,
				actorLogin: a.actorLogin,
				actorAvatarUrl: a.actorAvatarUrl,
				entityNumber: a.entityNumber,
				createdAt: a.createdAt,
			})),
			isDone: result.isDone,
			continueCursor: Cursor.make(result.continueCursor),
		};
	}),
);

// ---------------------------------------------------------------------------
// Workflow run implementations
// ---------------------------------------------------------------------------

/**
 * Enrich a workflow run with actor info and job count.
 */
const enrichWorkflowRun = (run: {
	readonly repositoryId: number;
	readonly githubRunId: number;
	readonly workflowName: string | null;
	readonly runNumber: number;
	readonly event: string;
	readonly status: string | null;
	readonly conclusion: string | null;
	readonly headBranch: string | null;
	readonly headSha: string;
	readonly actorUserId: number | null;
	readonly htmlUrl: string | null;
	readonly createdAt: number;
	readonly updatedAt: number;
}) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const raw = ctx.rawCtx;
		const actor = yield* resolveUser(run.actorUserId);
		const jobCount = yield* tryAggregateCount(
			() =>
				jobsByWorkflowRun.count(raw, {
					namespace: `${run.repositoryId}:${run.githubRunId}`,
				}),
			Effect.gen(function* () {
				const jobs = yield* ctx.db
					.query("github_workflow_jobs")
					.withIndex("by_repositoryId_and_githubRunId", (q) =>
						q
							.eq("repositoryId", run.repositoryId)
							.eq("githubRunId", run.githubRunId),
					)
					.collect();
				return jobs.length;
			}),
		);

		return {
			githubRunId: run.githubRunId,
			workflowName: run.workflowName,
			runNumber: run.runNumber,
			event: run.event,
			status: run.status,
			conclusion: run.conclusion,
			headBranch: run.headBranch,
			headSha: run.headSha,
			actorLogin: actor.login,
			actorAvatarUrl: actor.avatarUrl,
			jobCount,
			htmlUrl: run.htmlUrl,
			createdAt: run.createdAt,
			updatedAt: run.updatedAt,
		};
	});

listWorkflowRunsDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return [];

		const ctx = yield* ConfectQueryCtx;

		const runs = yield* ctx.db
			.query("github_workflow_runs")
			.withIndex("by_repositoryId_and_updatedAt", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.order("desc")
			.take(200);

		return yield* Effect.all(runs.map(enrichWorkflowRun), {
			concurrency: "unbounded",
		});
	}),
);

listWorkflowRunsPaginatedDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) {
			return {
				page: [],
				isDone: true,
				continueCursor: Cursor.make(""),
			};
		}

		const ctx = yield* ConfectQueryCtx;
		const paginationOpts = {
			cursor: args.cursor ?? null,
			numItems: args.numItems,
		};

		const result = yield* ctx.db
			.query("github_workflow_runs")
			.withIndex("by_repositoryId_and_updatedAt", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.order("desc")
			.paginate(paginationOpts);

		const page = yield* Effect.all(result.page.map(enrichWorkflowRun), {
			concurrency: "unbounded",
		});

		return {
			page,
			isDone: result.isDone,
			continueCursor: Cursor.make(result.continueCursor),
		};
	}),
);

getWorkflowRunDetailDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return null;

		const ctx = yield* ConfectQueryCtx;

		// Find the workflow run by runNumber — scan through all runs for this repo
		const allRuns = yield* ctx.db
			.query("github_workflow_runs")
			.withIndex("by_repositoryId_and_updatedAt", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.collect();

		const run = allRuns.find((r) => r.runNumber === args.runNumber);
		if (!run) return null;

		// Resolve actor
		const actor = yield* resolveUser(run.actorUserId);

		// Get jobs for this run
		const jobs = yield* ctx.db
			.query("github_workflow_jobs")
			.withIndex("by_repositoryId_and_githubRunId", (q) =>
				q.eq("repositoryId", repositoryId).eq("githubRunId", run.githubRunId),
			)
			.collect();

		return {
			repositoryId,
			githubRunId: run.githubRunId,
			workflowName: run.workflowName,
			runNumber: run.runNumber,
			runAttempt: run.runAttempt,
			event: run.event,
			status: run.status,
			conclusion: run.conclusion,
			headBranch: run.headBranch,
			headSha: run.headSha,
			actorLogin: actor.login,
			actorAvatarUrl: actor.avatarUrl,
			htmlUrl: run.htmlUrl,
			createdAt: run.createdAt,
			updatedAt: run.updatedAt,
			jobs: jobs.map((j) => ({
				githubJobId: j.githubJobId,
				name: j.name,
				status: j.status,
				conclusion: j.conclusion,
				startedAt: j.startedAt,
				completedAt: j.completedAt,
				runnerName: j.runnerName,
				stepsJson: j.stepsJson,
			})),
		};
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const projectionQueriesModule = makeRpcModule(
	{
		listRepos: listReposDef,
		getRepoOverview: getRepoOverviewDef,
		getSyncProgress: getSyncProgressDef,
		listPullRequests: listPullRequestsDef,
		listIssues: listIssuesDef,
		listActivity: listActivityDef,
		listWorkflowRuns: listWorkflowRunsDef,
		listPullRequestsPaginated: listPullRequestsPaginatedDef,
		listIssuesPaginated: listIssuesPaginatedDef,
		listActivityPaginated: listActivityPaginatedDef,
		listWorkflowRunsPaginated: listWorkflowRunsPaginatedDef,
		getIssueDetail: getIssueDetailDef,
		getPullRequestDetail: getPullRequestDetailDef,
		getWorkflowRunDetail: getWorkflowRunDetailDef,
		listPrFiles: listPrFilesDef,
		requestPrFileSync: requestPrFileSyncDef,
		getHomeDashboard: getHomeDashboardDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const {
	listRepos,
	getRepoOverview,
	getSyncProgress,
	listPullRequests,
	listIssues,
	listActivity,
	listWorkflowRuns,
	listPullRequestsPaginated,
	listIssuesPaginated,
	listActivityPaginated,
	listWorkflowRunsPaginated,
	getIssueDetail,
	getPullRequestDetail,
	getWorkflowRunDetail,
	listPrFiles,
	requestPrFileSync,
	getHomeDashboard,
} = projectionQueriesModule.handlers;
export { projectionQueriesModule };
export type ProjectionQueriesModule = typeof projectionQueriesModule;
