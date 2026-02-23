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
import { evaluateRepoPermissionWithDb } from "../shared/permissions";
import { DatabaseRpcModuleMiddlewares } from "./moduleMiddlewares";
import {
	ReadGitHubRepoByNameMiddleware,
	ReadGitHubRepoPermission,
} from "./security";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

/**
 * Get personalized sidebar repositories with overview stats.
 */
const listReposDef = factory.query({
	success: Schema.Array(
		Schema.Struct({
			repositoryId: Schema.Number,
			fullName: Schema.String,
			ownerLogin: Schema.String,
			ownerAvatarUrl: Schema.NullOr(Schema.String),
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
 * Search repositories globally across all accessible repos.
 */
const searchReposDef = factory.query({
	payload: {
		query: Schema.optional(Schema.String),
		org: Schema.optional(Schema.String),
		limit: Schema.optional(Schema.Number),
	},
	success: Schema.Array(
		Schema.Struct({
			repositoryId: Schema.Number,
			fullName: Schema.String,
			ownerLogin: Schema.String,
			name: Schema.String,
			lastPushAt: Schema.NullOr(Schema.Number),
			updatedAt: Schema.Number,
		}),
	),
});

/**
 * Get a single repo overview by owner/name.
 */
const getRepoOverviewDef = factory
	.query({
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
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Get pull request list for a repository.
 */
const listPullRequestsDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			state: Schema.optional(Schema.Literal("open", "closed")),
			limit: Schema.optional(Schema.Number),
		},
		success: Schema.Array(
			Schema.Struct({
				number: Schema.Number,
				state: Schema.Literal("open", "closed"),
				optimisticState: Schema.NullOr(
					Schema.Literal("pending", "failed", "confirmed"),
				),
				optimisticErrorMessage: Schema.NullOr(Schema.String),
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
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Get issue list for a repository.
 */
const listIssuesDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			state: Schema.optional(Schema.Literal("open", "closed")),
			limit: Schema.optional(Schema.Number),
		},
		success: Schema.Array(
			Schema.Struct({
				number: Schema.Number,
				state: Schema.Literal("open", "closed"),
				optimisticState: Schema.NullOr(
					Schema.Literal("pending", "failed", "confirmed"),
				),
				optimisticErrorMessage: Schema.NullOr(Schema.String),
				title: Schema.String,
				authorLogin: Schema.NullOr(Schema.String),
				authorAvatarUrl: Schema.NullOr(Schema.String),
				labelNames: Schema.Array(Schema.String),
				commentCount: Schema.Number,
				githubUpdatedAt: Schema.Number,
			}),
		),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Get activity feed for a repository.
 */
const listActivityDef = factory
	.query({
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
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Get files changed in a pull request (for diff view).
 * Returns files for the given PR, optionally filtered by headSha.
 * If no headSha is given, returns the most recently cached set.
 */
const listPrFilesDef = factory
	.query({
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
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

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
const requestPrFileSyncDef = factory
	.mutation({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			number: Schema.Number,
		},
		success: Schema.Struct({
			scheduled: Schema.Boolean,
		}),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

// ---------------------------------------------------------------------------
// Paginated list endpoint definitions
// ---------------------------------------------------------------------------

const PrListItem = Schema.Struct({
	number: Schema.Number,
	state: Schema.Literal("open", "closed"),
	optimisticState: Schema.NullOr(
		Schema.Literal("pending", "failed", "confirmed"),
	),
	optimisticErrorMessage: Schema.NullOr(Schema.String),
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
	optimisticState: Schema.NullOr(
		Schema.Literal("pending", "failed", "confirmed"),
	),
	optimisticErrorMessage: Schema.NullOr(Schema.String),
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
const listPullRequestsPaginatedDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			state: Schema.optional(Schema.Literal("open", "closed")),
			...PaginationOptionsSchema.fields,
		},
		success: PaginationResultSchema(PrListItem),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Paginated issue list with optional state filter.
 */
const listIssuesPaginatedDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			state: Schema.optional(Schema.Literal("open", "closed")),
			...PaginationOptionsSchema.fields,
		},
		success: PaginationResultSchema(IssueListItem),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Paginated activity feed.
 */
const listActivityPaginatedDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			...PaginationOptionsSchema.fields,
		},
		success: PaginationResultSchema(ActivityListItem),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Get workflow run list for a repository.
 */
const listWorkflowRunsDef = factory
	.query({
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
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

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
const listWorkflowRunsPaginatedDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			...PaginationOptionsSchema.fields,
		},
		success: PaginationResultSchema(WorkflowRunListItem),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Search issues and PRs by title within a repository.
 */
const searchIssuesAndPrsDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			query: Schema.String,
			limit: Schema.optional(Schema.Number),
			target: Schema.optional(Schema.Literal("issue", "pr")),
			authorLogin: Schema.optional(Schema.String),
			assigneeLogin: Schema.optional(Schema.String),
			labels: Schema.optional(Schema.Array(Schema.String)),
			state: Schema.optional(Schema.Literal("open", "closed", "merged")),
			updatedAfter: Schema.optional(Schema.Number),
		},
		success: Schema.Array(
			Schema.Struct({
				type: Schema.Literal("pr", "issue"),
				number: Schema.Number,
				state: Schema.Literal("open", "closed", "merged"),
				title: Schema.String,
				authorLogin: Schema.NullOr(Schema.String),
				githubUpdatedAt: Schema.Number,
			}),
		),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

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
const getWorkflowRunDetailDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			runNumber: Schema.Number,
		},
		success: Schema.NullOr(
			Schema.Struct({
				repositoryId: Schema.Number,
				githubRunId: Schema.Number,
				workflowId: Schema.Number,
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
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

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
	optimisticState: Schema.NullOr(
		Schema.Literal("pending", "failed", "confirmed"),
	),
	optimisticErrorMessage: Schema.NullOr(Schema.String),
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
	runNumber: Schema.NullOr(Schema.Number),
});

/**
 * Get full issue detail including body and comments.
 */
const AssigneeSchema = Schema.Struct({
	login: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
});

const getIssueDetailDef = factory
	.query({
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
				optimisticOperationType: Schema.NullOr(
					Schema.Literal(
						"create_issue",
						"create_comment",
						"update_issue_state",
						"merge_pull_request",
						"update_labels",
						"update_assignees",
					),
				),
				optimisticState: Schema.NullOr(
					Schema.Literal("pending", "failed", "confirmed"),
				),
				optimisticErrorMessage: Schema.NullOr(Schema.String),
				title: Schema.String,
				body: Schema.NullOr(Schema.String),
				authorLogin: Schema.NullOr(Schema.String),
				authorAvatarUrl: Schema.NullOr(Schema.String),
				assignees: Schema.Array(AssigneeSchema),
				labelNames: Schema.Array(Schema.String),
				commentCount: Schema.Number,
				closedAt: Schema.NullOr(Schema.Number),
				githubUpdatedAt: Schema.Number,
				comments: Schema.Array(CommentSchema),
			}),
		),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Get full pull request detail including body, comments, reviews, and check runs.
 */
const getPullRequestDetailDef = factory
	.query({
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
				optimisticOperationType: Schema.NullOr(
					Schema.Literal(
						"update_issue_state",
						"merge_pull_request",
						"update_pull_request_branch",
						"update_labels",
						"update_assignees",
					),
				),
				optimisticState: Schema.NullOr(
					Schema.Literal("pending", "failed", "confirmed"),
				),
				optimisticErrorMessage: Schema.NullOr(Schema.String),
				draft: Schema.Boolean,
				title: Schema.String,
				body: Schema.NullOr(Schema.String),
				authorLogin: Schema.NullOr(Schema.String),
				authorAvatarUrl: Schema.NullOr(Schema.String),
				assignees: Schema.Array(AssigneeSchema),
				labelNames: Schema.Array(Schema.String),
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
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

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
	githubUpdatedAt: Schema.Number,
});

const DashboardIssueItem = Schema.Struct({
	ownerLogin: Schema.String,
	repoName: Schema.String,
	number: Schema.Number,
	state: Schema.Literal("open", "closed"),
	title: Schema.String,
	authorLogin: Schema.NullOr(Schema.String),
	authorAvatarUrl: Schema.NullOr(Schema.String),
	labelNames: Schema.Array(Schema.String),
	commentCount: Schema.Number,
	githubUpdatedAt: Schema.Number,
});

const RepoQuickAccess = Schema.Struct({
	ownerLogin: Schema.String,
	name: Schema.String,
	fullName: Schema.String,
	lastPushAt: Schema.NullOr(Schema.Number),
});

/**
 * Get the home dashboard: 10 most recent PRs, 10 most recent issues, and a
 * list of accessible repos.
 */
const getHomeDashboardDef = factory.query({
	payload: {
		ownerLogin: Schema.optional(Schema.String),
	},
	success: Schema.Struct({
		githubLogin: Schema.NullOr(Schema.String),
		recentPrs: Schema.Array(DashboardPrItem),
		recentIssues: Schema.Array(DashboardIssueItem),
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
			Effect.succeed(0),
		);

		return { openPrCount, openIssueCount, failingCheckCount };
	});

const ANONYMOUS_FEATURED_REPO_LIMIT = 10;
const PERSONALIZED_REPO_LIMIT = 200;
const ANONYMOUS_PUBLIC_REPO_SCAN_LIMIT = 200;
const SEARCH_CANDIDATE_LIMIT = 200;
const GLOBAL_REPO_SEARCH_CANDIDATE_LIMIT = 300;
const QUERY_ENRICH_CONCURRENCY_LIMIT = 16;
const PR_FILES_RESULT_LIMIT = 1000;

/** Maximum repos to fetch detailed PR/issue/activity data for on the dashboard. */
const DASHBOARD_DETAIL_REPO_LIMIT = 15;

const sortByRecentActivity = <
	T extends {
		readonly pushedAt: number | null;
		readonly githubUpdatedAt: number;
		readonly fullName: string;
	},
>(
	repos: ReadonlyArray<T>,
): Array<T> =>
	[...repos].sort((a, b) => {
		const pushDelta = (b.pushedAt ?? 0) - (a.pushedAt ?? 0);
		if (pushDelta !== 0) return pushDelta;
		const updateDelta = b.githubUpdatedAt - a.githubUpdatedAt;
		if (updateDelta !== 0) return updateDelta;
		return a.fullName.localeCompare(b.fullName);
	});

const isRepoPrivate = (repo: {
	readonly visibility: string;
	readonly private: boolean;
}) => !(repo.visibility === "public" && repo.private === false);

const toRepoSearchResult = (repo: {
	readonly githubRepoId: number;
	readonly fullName: string;
	readonly ownerLogin: string;
	readonly name: string;
	readonly pushedAt: number | null;
	readonly githubUpdatedAt: number;
}) => ({
	repositoryId: repo.githubRepoId,
	fullName: repo.fullName,
	ownerLogin: repo.ownerLogin,
	name: repo.name,
	lastPushAt: repo.pushedAt,
	updatedAt: repo.githubUpdatedAt,
});

const repoSearchScore = (
	normalizedQuery: string,
	repo: {
		readonly fullName: string;
		readonly ownerLogin: string;
		readonly name: string;
	},
) => {
	if (normalizedQuery.length === 0) return 0;

	const fullName = repo.fullName.toLowerCase();
	const ownerLogin = repo.ownerLogin.toLowerCase();
	const name = repo.name.toLowerCase();

	if (fullName === normalizedQuery) return 500;
	if (name === normalizedQuery) return 450;
	if (fullName.startsWith(`${normalizedQuery}/`)) return 420;
	if (fullName.startsWith(normalizedQuery)) return 400;
	if (name.startsWith(normalizedQuery)) return 350;
	if (ownerLogin.startsWith(normalizedQuery)) return 300;
	if (fullName.includes(normalizedQuery)) return 220;
	if (name.includes(normalizedQuery)) return 180;
	if (ownerLogin.includes(normalizedQuery)) return 120;
	return 0;
};

const sortFeaturedPublicRepos = <
	T extends {
		readonly stargazersCount?: number;
		readonly githubUpdatedAt: number;
		readonly pushedAt: number | null;
		readonly fullName: string;
	},
>(
	repos: ReadonlyArray<T>,
): Array<T> =>
	[...repos].sort((a, b) => {
		const starDelta = (b.stargazersCount ?? 0) - (a.stargazersCount ?? 0);
		if (starDelta !== 0) return starDelta;
		const pushDelta = (b.pushedAt ?? 0) - (a.pushedAt ?? 0);
		if (pushDelta !== 0) return pushDelta;
		const updateDelta = b.githubUpdatedAt - a.githubUpdatedAt;
		if (updateDelta !== 0) return updateDelta;
		return a.fullName.localeCompare(b.fullName);
	});

const loadFeaturedPublicRepos = Effect.gen(function* () {
	const ctx = yield* ConfectQueryCtx;
	const publicRepos = yield* ctx.db
		.query("github_repositories")
		.withIndex("by_private_and_githubUpdatedAt", (q) => q.eq("private", false))
		.order("desc")
		.take(ANONYMOUS_PUBLIC_REPO_SCAN_LIMIT);

	return sortFeaturedPublicRepos(publicRepos).slice(
		0,
		ANONYMOUS_FEATURED_REPO_LIMIT,
	);
});

const loadReposByIds = (repositoryIds: ReadonlyArray<number>) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const repoOptions = yield* Effect.forEach(
			repositoryIds,
			(repositoryId) =>
				ctx.db
					.query("github_repositories")
					.withIndex("by_githubRepoId", (q) =>
						q.eq("githubRepoId", repositoryId),
					)
					.first(),
			{ concurrency: 16 },
		);

		const repos = [];
		for (const repoOption of repoOptions) {
			if (Option.isSome(repoOption)) {
				repos.push(repoOption.value);
			}
		}

		return repos;
	});

const selectSidebarAndDashboardRepos = Effect.gen(function* () {
	const ctx = yield* ConfectQueryCtx;
	const identity = yield* ctx.auth.getUserIdentity();

	if (Option.isNone(identity)) {
		return yield* loadFeaturedPublicRepos;
	}

	const userId = identity.value.subject;
	const permissions = yield* ctx.db
		.query("github_user_repo_permissions")
		.withIndex("by_userId", (q) => q.eq("userId", userId))
		.collect();

	const memberRepoIds = new Set<number>();
	for (const permission of permissions) {
		if (!hasPullPermission(permission)) continue;
		memberRepoIds.add(permission.repositoryId);
	}

	const memberRepos = yield* loadReposByIds([...memberRepoIds]);
	const connectedRepos = yield* ctx.db
		.query("github_repositories")
		.withIndex("by_connectedByUserId_and_githubUpdatedAt", (q) =>
			q.eq("connectedByUserId", userId),
		)
		.order("desc")
		.collect();

	const githubLogin = yield* resolveViewerGitHub;
	const ownedRepos =
		githubLogin === null
			? []
			: yield* ctx.db
					.query("github_repositories")
					.withIndex("by_ownerLogin_and_name", (q) =>
						q.eq("ownerLogin", githubLogin),
					)
					.collect();

	const personalizedWithOwnedRepos = [...memberRepos];
	const seenRepoIds = new Set<number>(
		memberRepos.map((repo) => repo.githubRepoId),
	);
	for (const repo of connectedRepos) {
		if (seenRepoIds.has(repo.githubRepoId)) {
			continue;
		}
		seenRepoIds.add(repo.githubRepoId);
		personalizedWithOwnedRepos.push(repo);
	}
	for (const repo of ownedRepos) {
		if (seenRepoIds.has(repo.githubRepoId)) {
			continue;
		}
		seenRepoIds.add(repo.githubRepoId);
		personalizedWithOwnedRepos.push(repo);
	}

	if (personalizedWithOwnedRepos.length > 0) {
		return sortByRecentActivity(personalizedWithOwnedRepos).slice(
			0,
			PERSONALIZED_REPO_LIMIT,
		);
	}

	return yield* loadFeaturedPublicRepos;
});

searchReposDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const identity = yield* ctx.auth.getUserIdentity();
		const userId = Option.isSome(identity) ? identity.value.subject : null;

		const normalizedQuery = (args.query ?? "").trim().toLowerCase();
		const normalizedOrg = (args.org ?? "").trim().toLowerCase();
		const maxResults = Math.min(Math.max(args.limit ?? 12, 1), 50);

		if (normalizedQuery.length === 0) {
			const repos = yield* selectSidebarAndDashboardRepos;
			const filteredRepos =
				normalizedOrg.length === 0
					? repos
					: repos.filter(
							(repo) => repo.ownerLogin.toLowerCase() === normalizedOrg,
						);

			return filteredRepos.slice(0, maxResults).map(toRepoSearchResult);
		}

		const candidateRepos =
			userId === null
				? yield* ctx.db
						.query("github_repositories")
						.withIndex("by_ownerLogin_and_name", (q) => q.gte("ownerLogin", ""))
						.take(GLOBAL_REPO_SEARCH_CANDIDATE_LIMIT)
				: yield* Effect.gen(function* () {
						const permissions = yield* ctx.db
							.query("github_user_repo_permissions")
							.withIndex("by_userId", (q) => q.eq("userId", userId))
							.collect();

						const memberRepoIds = new Set<number>();
						for (const permission of permissions) {
							if (!hasPullPermission(permission)) continue;
							memberRepoIds.add(permission.repositoryId);
						}

						const [memberRepos, connectedRepos] = yield* Effect.all([
							loadReposByIds([...memberRepoIds]),
							ctx.db
								.query("github_repositories")
								.withIndex("by_connectedByUserId_and_githubUpdatedAt", (q) =>
									q.eq("connectedByUserId", userId),
								)
								.order("desc")
								.take(GLOBAL_REPO_SEARCH_CANDIDATE_LIMIT),
						]);

						const reposById = new Map<number, (typeof memberRepos)[number]>();
						for (const repo of memberRepos) {
							reposById.set(repo.githubRepoId, repo);
						}
						for (const repo of connectedRepos) {
							reposById.set(repo.githubRepoId, repo);
						}

						const repos = [...reposById.values()];
						if (repos.length > 0) return repos;

						const githubLogin = yield* resolveViewerGitHub;
						if (githubLogin === null) return repos;

						return yield* ctx.db
							.query("github_repositories")
							.withIndex("by_ownerLogin_and_name", (q) =>
								q.eq("ownerLogin", githubLogin),
							)
							.take(GLOBAL_REPO_SEARCH_CANDIDATE_LIMIT);
					});

		const candidateMatches = [];
		for (const repo of candidateRepos) {
			if (userId === null && isRepoPrivate(repo)) {
				continue;
			}

			if (
				normalizedOrg.length > 0 &&
				repo.ownerLogin.toLowerCase() !== normalizedOrg
			) {
				continue;
			}

			const score = repoSearchScore(normalizedQuery, repo);
			if (score === 0) {
				continue;
			}

			candidateMatches.push({ repo, score });
		}

		candidateMatches.sort((a, b) => {
			const scoreDelta = b.score - a.score;
			if (scoreDelta !== 0) return scoreDelta;

			const pushDelta = (b.repo.pushedAt ?? 0) - (a.repo.pushedAt ?? 0);
			if (pushDelta !== 0) return pushDelta;

			const updateDelta = b.repo.githubUpdatedAt - a.repo.githubUpdatedAt;
			if (updateDelta !== 0) return updateDelta;

			return a.repo.fullName.localeCompare(b.repo.fullName);
		});

		return candidateMatches
			.slice(0, maxResults)
			.map((match) => toRepoSearchResult(match.repo));
	}),
);

listReposDef.implement(() =>
	Effect.gen(function* () {
		const repos = yield* selectSidebarAndDashboardRepos;

		const ownerAvatarUrlByOwnerId = new Map<number, string | null>();
		const resolveCachedOwnerAvatarUrl = (ownerId: number) =>
			Effect.gen(function* () {
				const cached = ownerAvatarUrlByOwnerId.get(ownerId);
				if (cached !== undefined) return cached;

				const ownerAvatarUrl = yield* resolveOwnerAvatarUrl(ownerId);
				ownerAvatarUrlByOwnerId.set(ownerId, ownerAvatarUrl);
				return ownerAvatarUrl;
			});

		return yield* Effect.forEach(
			repos,
			(repo) =>
				Effect.gen(function* () {
					const [counts, ownerAvatarUrl] = yield* Effect.all([
						computeRepoCounts(repo.githubRepoId),
						resolveCachedOwnerAvatarUrl(repo.ownerId),
					]);

					return {
						repositoryId: repo.githubRepoId,
						fullName: repo.fullName,
						ownerLogin: repo.ownerLogin,
						ownerAvatarUrl,
						name: repo.name,
						openPrCount: counts.openPrCount,
						openIssueCount: counts.openIssueCount,
						failingCheckCount: counts.failingCheckCount,
						lastPushAt: repo.pushedAt,
						updatedAt: repo.githubUpdatedAt,
					};
				}),
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);
	}),
);

getRepoOverviewDef.implement((_args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const permission = yield* ReadGitHubRepoPermission;
		if (!permission.isAllowed || permission.repository === null) {
			return null;
		}
		const repository = permission.repository;

		const repoOpt = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) =>
				q.eq("githubRepoId", repository.repositoryId),
			)
			.first();

		if (Option.isNone(repoOpt)) return null;

		const repo = repoOpt.value;
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

getSyncProgressDef.implement((_args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const repository = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", _args.ownerLogin).eq("name", _args.name),
			)
			.first();

		if (Option.isNone(repository)) {
			return null;
		}

		const isPrivate = !(
			repository.value.visibility === "public" &&
			repository.value.private === false
		);

		const identity = yield* ctx.auth.getUserIdentity();
		const userId = Option.isSome(identity) ? identity.value.subject : null;
		const decision = yield* evaluateRepoPermissionWithDb(ctx.db, {
			repositoryId: repository.value.githubRepoId,
			isPrivate,
			userId,
			required: "pull",
			requireAuthenticated: false,
		});

		if (!decision.isAllowed) {
			return null;
		}

		const repositoryId = repository.value.githubRepoId;
		const installationId = repository.value.installationId;

		if (installationId <= 0) return null;

		// Find the bootstrap sync job for this repository
		const lockKey = `repo-bootstrap:${installationId}:${repositoryId}`;
		const job = yield* ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", lockKey))
			.first();

		if (Option.isNone(job)) return null;

		const j = job.value;
		return {
			state: j.state,
			currentStep: j.currentStep ?? null,
			completedSteps: [...(j.completedSteps ?? [])],
			itemsFetched: j.itemsFetched ?? 0,
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
	readonly optimisticState?: "pending" | "failed" | "confirmed" | null;
	readonly optimisticErrorMessage?: string | null;
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
			optimisticState: pr.optimisticState ?? null,
			optimisticErrorMessage: pr.optimisticErrorMessage ?? null,
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
		const listLimit = Math.min(args.limit ?? 50, 200);

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

		const prs = yield* query.take(listLimit);

		return yield* Effect.all(prs.map(enrichPr), {
			concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT,
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
	readonly optimisticState?: "pending" | "failed" | "confirmed" | null;
	readonly optimisticErrorMessage?: string | null;
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
			optimisticState: issue.optimisticState ?? null,
			optimisticErrorMessage: issue.optimisticErrorMessage ?? null,
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
		const listLimit = Math.min(args.limit ?? 50, 200);

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

		const issues = yield* query.take(listLimit);

		return yield* Effect.all(issues.map(enrichIssue), {
			concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT,
		});
	}),
);

listActivityDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const permission = yield* ReadGitHubRepoPermission;
		if (!permission.isAllowed || permission.repository === null) {
			return [];
		}

		const repositoryId = permission.repository.repositoryId;
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

// -- Search implementation ---------------------------------------------------

searchIssuesAndPrsDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return [];

		const ctx = yield* ConfectQueryCtx;
		const maxResults = Math.min(args.limit ?? 20, 100);
		const normalizedTokens = args.query
			.toLowerCase()
			.split(" ")
			.map((token) => token.trim())
			.filter((token) => token.length > 0);
		const normalizedAuthor = args.authorLogin?.toLowerCase().trim() ?? null;
		const normalizedAssignee = args.assigneeLogin?.toLowerCase().trim() ?? null;
		const normalizedLabels = (args.labels ?? [])
			.map((label) => label.toLowerCase())
			.filter((label) => label.length > 0);

		const shouldSearchPrs = args.target === undefined || args.target === "pr";
		const shouldSearchIssues =
			args.target === undefined || args.target === "issue";

		const loginByUserId = new Map<number, string | null>();
		const resolveLoginByUserId = (userId: number | null) =>
			Effect.gen(function* () {
				if (userId === null) return null;
				const cached = loginByUserId.get(userId);
				if (cached !== undefined) return cached;
				const user = yield* resolveUser(userId);
				loginByUserId.set(userId, user.login);
				return user.login;
			});

		const matchesAllTokens = (title: string, body: string | null) => {
			if (normalizedTokens.length === 0) return true;
			const lowerTitle = title.toLowerCase();
			const lowerBody = (body ?? "").toLowerCase();
			for (const token of normalizedTokens) {
				if (!lowerTitle.includes(token) && !lowerBody.includes(token)) {
					return false;
				}
			}
			return true;
		};

		const matchesAllLabels = (labels: ReadonlyArray<string>) => {
			if (normalizedLabels.length === 0) return true;
			if (labels.length === 0) return false;
			const normalized = labels.map((label) => label.toLowerCase());
			for (const expected of normalizedLabels) {
				if (!normalized.includes(expected)) return false;
			}
			return true;
		};

		const compactLogin = (value: string) =>
			value.toLowerCase().replace(/[^a-z0-9]/g, "");

		const matchesLoginAlias = (login: string, queryAlias: string) => {
			const alias = queryAlias.trim().toLowerCase();
			if (alias.length === 0) return true;

			const loginLower = login.toLowerCase();
			if (loginLower === alias) return true;
			if (loginLower.startsWith(alias)) return true;
			if (loginLower.includes(alias)) return true;

			const compactAlias = compactLogin(alias);
			const compact = compactLogin(loginLower);
			if (compactAlias.length === 0) return false;
			if (compact === compactAlias) return true;
			if (compact.startsWith(compactAlias)) return true;
			if (compact.includes(compactAlias)) return true;

			const aliasTokens = alias
				.split(/[\s._-]+/)
				.map((token) => token.trim())
				.filter((token) => token.length > 0);
			if (aliasTokens.length <= 1) return false;

			for (const token of aliasTokens) {
				const compactToken = compactLogin(token);
				if (compactToken.length === 0) continue;
				if (!compact.includes(compactToken)) return false;
			}
			return true;
		};

		const prCandidates = shouldSearchPrs
			? yield* Effect.gen(function* () {
					if (args.state === "merged") {
						const mergedCandidates = yield* ctx.db
							.query("github_pull_requests")
							.withIndex(
								"by_repositoryId_and_state_and_githubUpdatedAt",
								(q) =>
									args.updatedAfter === undefined
										? q.eq("repositoryId", repositoryId).eq("state", "closed")
										: q
												.eq("repositoryId", repositoryId)
												.eq("state", "closed")
												.gte("githubUpdatedAt", args.updatedAfter),
							)
							.order("desc")
							.take(SEARCH_CANDIDATE_LIMIT);

						return mergedCandidates.filter((pr) => pr.mergedAt !== null);
					}

					if (args.state === "open" || args.state === "closed") {
						const stateFilter = args.state;
						return yield* ctx.db
							.query("github_pull_requests")
							.withIndex(
								"by_repositoryId_and_state_and_githubUpdatedAt",
								(q) =>
									args.updatedAfter === undefined
										? q
												.eq("repositoryId", repositoryId)
												.eq("state", stateFilter)
										: q
												.eq("repositoryId", repositoryId)
												.eq("state", stateFilter)
												.gte("githubUpdatedAt", args.updatedAfter),
							)
							.order("desc")
							.take(SEARCH_CANDIDATE_LIMIT);
					}

					const [openCandidates, closedCandidates] = yield* Effect.all([
						ctx.db
							.query("github_pull_requests")
							.withIndex(
								"by_repositoryId_and_state_and_githubUpdatedAt",
								(q) =>
									args.updatedAfter === undefined
										? q.eq("repositoryId", repositoryId).eq("state", "open")
										: q
												.eq("repositoryId", repositoryId)
												.eq("state", "open")
												.gte("githubUpdatedAt", args.updatedAfter),
							)
							.order("desc")
							.take(SEARCH_CANDIDATE_LIMIT),
						ctx.db
							.query("github_pull_requests")
							.withIndex(
								"by_repositoryId_and_state_and_githubUpdatedAt",
								(q) =>
									args.updatedAfter === undefined
										? q.eq("repositoryId", repositoryId).eq("state", "closed")
										: q
												.eq("repositoryId", repositoryId)
												.eq("state", "closed")
												.gte("githubUpdatedAt", args.updatedAfter),
							)
							.order("desc")
							.take(SEARCH_CANDIDATE_LIMIT),
					]);

					return [...openCandidates, ...closedCandidates]
						.sort((a, b) => b.githubUpdatedAt - a.githubUpdatedAt)
						.slice(0, SEARCH_CANDIDATE_LIMIT);
				})
			: [];

		const prItemsWithNulls = yield* Effect.all(
			prCandidates.map((pr) =>
				Effect.gen(function* () {
					const prState: "open" | "closed" | "merged" =
						pr.state === "closed" && pr.mergedAt !== null ? "merged" : pr.state;
					if (
						args.updatedAfter !== undefined &&
						pr.githubUpdatedAt < args.updatedAfter
					) {
						return null;
					}
					if (args.state === "merged" && pr.mergedAt === null) return null;
					if (args.state === "open" && pr.state !== "open") return null;
					if (args.state === "closed" && pr.state !== "closed") return null;
					if (!matchesAllTokens(pr.title, pr.body)) return null;
					if (!matchesAllLabels(pr.labelNames ?? [])) return null;

					const authorLogin = yield* resolveLoginByUserId(pr.authorUserId);
					if (normalizedAuthor !== null) {
						if (authorLogin === null) return null;
						if (!matchesLoginAlias(authorLogin, normalizedAuthor)) return null;
					}

					if (normalizedAssignee !== null) {
						if (pr.assigneeUserIds.length === 0) return null;
						const assigneeLogins = yield* Effect.all(
							pr.assigneeUserIds.map((userId) => resolveLoginByUserId(userId)),
							{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
						);
						const hasMatchingAssignee = assigneeLogins.some(
							(login) =>
								login !== null && matchesLoginAlias(login, normalizedAssignee),
						);
						if (!hasMatchingAssignee) return null;
					}

					const item: {
						type: "pr";
						number: number;
						state: "open" | "closed" | "merged";
						title: string;
						authorLogin: string | null;
						githubUpdatedAt: number;
					} = {
						type: "pr",
						number: pr.number,
						state: prState,
						title: pr.title,
						authorLogin,
						githubUpdatedAt: pr.githubUpdatedAt,
					};
					return item;
				}),
			),
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);

		const prItems: Array<{
			type: "pr";
			number: number;
			state: "open" | "closed" | "merged";
			title: string;
			authorLogin: string | null;
			githubUpdatedAt: number;
		}> = [];
		for (const item of prItemsWithNulls) {
			if (item !== null) prItems.push(item);
		}

		const issueCandidates = shouldSearchIssues
			? yield* Effect.gen(function* () {
					if (args.state === "merged") {
						return [];
					}

					if (args.state === "open" || args.state === "closed") {
						const stateFilter = args.state;
						return yield* ctx.db
							.query("github_issues")
							.withIndex(
								"by_repositoryId_and_state_and_githubUpdatedAt",
								(q) =>
									args.updatedAfter === undefined
										? q
												.eq("repositoryId", repositoryId)
												.eq("state", stateFilter)
										: q
												.eq("repositoryId", repositoryId)
												.eq("state", stateFilter)
												.gte("githubUpdatedAt", args.updatedAfter),
							)
							.order("desc")
							.take(SEARCH_CANDIDATE_LIMIT);
					}

					const [openCandidates, closedCandidates] = yield* Effect.all([
						ctx.db
							.query("github_issues")
							.withIndex(
								"by_repositoryId_and_state_and_githubUpdatedAt",
								(q) =>
									args.updatedAfter === undefined
										? q.eq("repositoryId", repositoryId).eq("state", "open")
										: q
												.eq("repositoryId", repositoryId)
												.eq("state", "open")
												.gte("githubUpdatedAt", args.updatedAfter),
							)
							.order("desc")
							.take(SEARCH_CANDIDATE_LIMIT),
						ctx.db
							.query("github_issues")
							.withIndex(
								"by_repositoryId_and_state_and_githubUpdatedAt",
								(q) =>
									args.updatedAfter === undefined
										? q.eq("repositoryId", repositoryId).eq("state", "closed")
										: q
												.eq("repositoryId", repositoryId)
												.eq("state", "closed")
												.gte("githubUpdatedAt", args.updatedAfter),
							)
							.order("desc")
							.take(SEARCH_CANDIDATE_LIMIT),
					]);

					return [...openCandidates, ...closedCandidates]
						.sort((a, b) => b.githubUpdatedAt - a.githubUpdatedAt)
						.slice(0, SEARCH_CANDIDATE_LIMIT);
				})
			: [];

		const issueItemsWithNulls = yield* Effect.all(
			issueCandidates.map((issue) =>
				Effect.gen(function* () {
					if (issue.isPullRequest) return null;
					if (args.state === "merged") return null;
					if (args.state !== undefined && issue.state !== args.state)
						return null;
					if (
						args.updatedAfter !== undefined &&
						issue.githubUpdatedAt < args.updatedAfter
					)
						return null;
					if (!matchesAllTokens(issue.title, issue.body)) return null;
					if (!matchesAllLabels(issue.labelNames)) return null;

					const authorLogin = yield* resolveLoginByUserId(issue.authorUserId);
					if (normalizedAuthor !== null) {
						if (authorLogin === null) return null;
						if (!matchesLoginAlias(authorLogin, normalizedAuthor)) return null;
					}

					if (normalizedAssignee !== null) {
						if (issue.assigneeUserIds.length === 0) return null;
						const assigneeLogins = yield* Effect.all(
							issue.assigneeUserIds.map((userId) =>
								resolveLoginByUserId(userId),
							),
							{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
						);
						const hasMatchingAssignee = assigneeLogins.some(
							(login) =>
								login !== null && matchesLoginAlias(login, normalizedAssignee),
						);
						if (!hasMatchingAssignee) return null;
					}

					const item: {
						type: "issue";
						number: number;
						state: "open" | "closed";
						title: string;
						authorLogin: string | null;
						githubUpdatedAt: number;
					} = {
						type: "issue",
						number: issue.number,
						state: issue.state,
						title: issue.title,
						authorLogin,
						githubUpdatedAt: issue.githubUpdatedAt,
					};
					return item;
				}),
			),
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);

		const issueItems: Array<{
			type: "issue";
			number: number;
			state: "open" | "closed";
			title: string;
			authorLogin: string | null;
			githubUpdatedAt: number;
		}> = [];
		for (const item of issueItemsWithNulls) {
			if (item !== null) issueItems.push(item);
		}

		const merged = [...prItems, ...issueItems].sort(
			(a, b) => b.githubUpdatedAt - a.githubUpdatedAt,
		);
		return merged.slice(0, maxResults);
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

getHomeDashboardDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const githubLogin = yield* resolveViewerGitHub;

		const accessibleRepos = yield* selectSidebarAndDashboardRepos;

		const ownerFilter =
			args.ownerLogin !== undefined && args.ownerLogin.length > 0
				? args.ownerLogin
				: null;

		const filteredRepos =
			ownerFilter === null
				? accessibleRepos
				: accessibleRepos.filter((repo) => repo.ownerLogin === ownerFilter);

		const repos = filteredRepos.map((repo) => ({
			ownerLogin: repo.ownerLogin,
			name: repo.name,
			fullName: repo.fullName,
			lastPushAt: repo.pushedAt,
		}));

		// Fetch 10 most recent open PRs across all filtered repos
		const allPrsByRepo = yield* Effect.all(
			filteredRepos.slice(0, DASHBOARD_DETAIL_REPO_LIMIT).map((repo) =>
				Effect.gen(function* () {
					const prs = yield* ctx.db
						.query("github_pull_requests")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repo.githubRepoId).eq("state", "open"),
						)
						.order("desc")
						.take(10);

					return yield* Effect.all(
						prs.map((pr) =>
							Effect.gen(function* () {
								const author = yield* resolveUser(pr.authorUserId);
								return {
									ownerLogin: repo.ownerLogin,
									repoName: repo.name,
									number: pr.number,
									state: pr.state,
									draft: pr.draft,
									title: pr.title,
									authorLogin: author.login,
									authorAvatarUrl: author.avatarUrl,
									commentCount: 0,
									githubUpdatedAt: pr.githubUpdatedAt,
								};
							}),
						),
						{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
					);
				}),
			),
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);

		const recentPrs = allPrsByRepo
			.flat()
			.sort((a, b) => b.githubUpdatedAt - a.githubUpdatedAt)
			.slice(0, 10);

		// Fetch 10 most recent open issues across all filtered repos
		const allIssuesByRepo = yield* Effect.all(
			filteredRepos.slice(0, DASHBOARD_DETAIL_REPO_LIMIT).map((repo) =>
				Effect.gen(function* () {
					const issues = yield* ctx.db
						.query("github_issues")
						.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
							q.eq("repositoryId", repo.githubRepoId).eq("state", "open"),
						)
						.order("desc")
						.take(10);

					return yield* Effect.all(
						issues
							.filter((issue) => !issue.isPullRequest)
							.map((issue) =>
								Effect.gen(function* () {
									const author = yield* resolveUser(issue.authorUserId);
									return {
										ownerLogin: repo.ownerLogin,
										repoName: repo.name,
										number: issue.number,
										state: issue.state,
										title: issue.title,
										authorLogin: author.login,
										authorAvatarUrl: author.avatarUrl,
										labelNames: [...issue.labelNames],
										commentCount: issue.commentCount,
										githubUpdatedAt: issue.githubUpdatedAt,
									};
								}),
							),
						{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
					);
				}),
			),
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);

		const recentIssues = allIssuesByRepo
			.flat()
			.sort((a, b) => b.githubUpdatedAt - a.githubUpdatedAt)
			.slice(0, 10);

		return {
			githubLogin,
			recentPrs,
			recentIssues,
			repos,
		};
	}),
);

// -- Helper: resolve owner avatar by ownerId (user or org) ------------------

const resolveOwnerAvatarUrl = (ownerId: number) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		// Try github_users first (covers User, Bot, and Organization types)
		const user = yield* ctx.db
			.query("github_users")
			.withIndex("by_githubUserId", (q) => q.eq("githubUserId", ownerId))
			.first();
		if (Option.isSome(user)) return user.value.avatarUrl;
		// Fall back to github_organizations
		const org = yield* ctx.db
			.query("github_organizations")
			.withIndex("by_githubOrgId", (q) => q.eq("githubOrgId", ownerId))
			.first();
		if (Option.isSome(org)) return org.value.avatarUrl;
		return null;
	});

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

const findRepo = (_ownerLogin: string, _name: string) =>
	Effect.gen(function* () {
		const permission = yield* ReadGitHubRepoPermission;
		if (!permission.isAllowed || permission.repository === null) {
			return null;
		}

		return permission.repository.repositoryId;
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

		// Resolve assignees
		const assignees = yield* Effect.all(
			issue.assigneeUserIds.map((uid) =>
				Effect.gen(function* () {
					const u = yield* resolveUser(uid);
					return u.login !== null
						? { login: u.login, avatarUrl: u.avatarUrl }
						: null;
				}),
			),
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);
		const resolvedAssignees = assignees.filter(
			(a): a is { login: string; avatarUrl: string | null } => a !== null,
		);

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
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);

		return {
			repositoryId,
			number: issue.number,
			state: issue.state,
			optimisticOperationType: issue.optimisticOperationType ?? null,
			optimisticState: issue.optimisticState ?? null,
			optimisticErrorMessage: issue.optimisticErrorMessage ?? null,
			title: issue.title,
			body: issue.body,
			authorLogin: author.login,
			authorAvatarUrl: author.avatarUrl,
			assignees: resolvedAssignees,
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

		// Resolve assignees
		const prAssignees = yield* Effect.all(
			pr.assigneeUserIds.map((uid) =>
				Effect.gen(function* () {
					const u = yield* resolveUser(uid);
					return u.login !== null
						? { login: u.login, avatarUrl: u.avatarUrl }
						: null;
				}),
			),
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);
		const resolvedPrAssignees = prAssignees.filter(
			(a): a is { login: string; avatarUrl: string | null } => a !== null,
		);

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
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
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
						optimisticState: r.optimisticState ?? null,
						optimisticErrorMessage: r.optimisticErrorMessage ?? null,
					};
				}),
			),
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
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
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);

		// Get check runs for this PR's head SHA (bounded)
		const checkRuns = yield* ctx.db
			.query("github_check_runs")
			.withIndex("by_repositoryId_and_headSha", (q) =>
				q.eq("repositoryId", repositoryId).eq("headSha", pr.headSha),
			)
			.take(200);

		const workflowRunsForHead = yield* ctx.db
			.query("github_workflow_runs")
			.withIndex("by_repositoryId_and_headSha", (q) =>
				q.eq("repositoryId", repositoryId).eq("headSha", pr.headSha),
			)
			.take(20);

		let latestRunNumberForHead: number | null = null;
		let latestRunUpdatedAt = -1;
		for (const workflowRun of workflowRunsForHead) {
			if (workflowRun.updatedAt > latestRunUpdatedAt) {
				latestRunUpdatedAt = workflowRun.updatedAt;
				latestRunNumberForHead = workflowRun.runNumber;
			}
		}

		const jobsByRun = yield* Effect.forEach(
			workflowRunsForHead,
			(workflowRun) =>
				Effect.map(
					ctx.db
						.query("github_workflow_jobs")
						.withIndex("by_repositoryId_and_githubRunId", (q) =>
							q
								.eq("repositoryId", repositoryId)
								.eq("githubRunId", workflowRun.githubRunId),
						)
						.collect(),
					(jobs) => ({
						runNumber: workflowRun.runNumber,
						updatedAt: workflowRun.updatedAt,
						jobs,
					}),
				),
			{ concurrency: 8 },
		);

		const sortedJobsByRun = [...jobsByRun].sort(
			(a, b) => b.updatedAt - a.updatedAt,
		);
		const runNumberByJobName = new Map<string, number>();
		for (const runJobs of sortedJobsByRun) {
			for (const workflowJob of runJobs.jobs) {
				if (!runNumberByJobName.has(workflowJob.name)) {
					runNumberByJobName.set(workflowJob.name, runJobs.runNumber);
				}
			}
		}

		return {
			repositoryId,
			number: pr.number,
			state: pr.state,
			optimisticOperationType: pr.optimisticOperationType ?? null,
			optimisticState: pr.optimisticState ?? null,
			optimisticErrorMessage: pr.optimisticErrorMessage ?? null,
			draft: pr.draft,
			title: pr.title,
			body: pr.body,
			authorLogin: author.login,
			authorAvatarUrl: author.avatarUrl,
			assignees: resolvedPrAssignees,
			labelNames: [...(pr.labelNames ?? [])],
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
				runNumber: runNumberByJobName.get(cr.name) ?? latestRunNumberForHead,
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
				.take(PR_FILES_RESULT_LIMIT);

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
			.take(PR_FILES_RESULT_LIMIT);

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
		const permission = yield* ReadGitHubRepoPermission;
		if (!permission.isAllowed || permission.repository === null) {
			return { scheduled: false };
		}

		const repositoryId = permission.repository.repositoryId;

		const installationId = permission.repository.installationId;
		if (installationId <= 0) return { scheduled: false };

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
		yield* Effect.promise(() =>
			ctx.scheduler.runAfter(0, internal.rpc.githubActions.syncPrFiles, {
				ownerLogin: args.ownerLogin,
				name: args.name,
				repositoryId,
				pullRequestNumber: args.number,
				headSha,
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
			concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT,
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
			concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT,
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
			concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT,
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
			concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT,
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

		const run = yield* ctx.db
			.query("github_workflow_runs")
			.withIndex("by_repositoryId_and_runNumber", (q) =>
				q.eq("repositoryId", repositoryId).eq("runNumber", args.runNumber),
			)
			.first();
		if (Option.isNone(run)) return null;

		// Resolve actor
		const actor = yield* resolveUser(run.value.actorUserId);

		// Get jobs for this run
		const jobs = yield* ctx.db
			.query("github_workflow_jobs")
			.withIndex("by_repositoryId_and_githubRunId", (q) =>
				q
					.eq("repositoryId", repositoryId)
					.eq("githubRunId", run.value.githubRunId),
			)
			.collect();

		return {
			repositoryId,
			githubRunId: run.value.githubRunId,
			workflowId: run.value.workflowId,
			workflowName: run.value.workflowName,
			runNumber: run.value.runNumber,
			runAttempt: run.value.runAttempt,
			event: run.value.event,
			status: run.value.status,
			conclusion: run.value.conclusion,
			headBranch: run.value.headBranch,
			headSha: run.value.headSha,
			actorLogin: actor.login,
			actorAvatarUrl: actor.avatarUrl,
			htmlUrl: run.value.htmlUrl,
			createdAt: run.value.createdAt,
			updatedAt: run.value.updatedAt,
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
// List distinct labels for a repository (aggregated from issues + PRs)
// ---------------------------------------------------------------------------

const listRepoLabelsDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
		},
		success: Schema.Array(Schema.String),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

const REPO_LABEL_SCAN_LIMIT_PER_STATE = 400;

listRepoLabelsDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return [];

		const ctx = yield* ConfectQueryCtx;
		const labelSet = new Set<string>();

		const [openIssues, closedIssues, openPrs, closedPrs] = yield* Effect.all([
			ctx.db
				.query("github_issues")
				.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
					q.eq("repositoryId", repositoryId).eq("state", "open"),
				)
				.order("desc")
				.take(REPO_LABEL_SCAN_LIMIT_PER_STATE),
			ctx.db
				.query("github_issues")
				.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
					q.eq("repositoryId", repositoryId).eq("state", "closed"),
				)
				.order("desc")
				.take(REPO_LABEL_SCAN_LIMIT_PER_STATE),
			ctx.db
				.query("github_pull_requests")
				.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
					q.eq("repositoryId", repositoryId).eq("state", "open"),
				)
				.order("desc")
				.take(REPO_LABEL_SCAN_LIMIT_PER_STATE),
			ctx.db
				.query("github_pull_requests")
				.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
					q.eq("repositoryId", repositoryId).eq("state", "closed"),
				)
				.order("desc")
				.take(REPO_LABEL_SCAN_LIMIT_PER_STATE),
		]);

		const issues = [...openIssues, ...closedIssues];

		for (const issue of issues) {
			for (const label of issue.labelNames) {
				labelSet.add(label);
			}
		}

		const prs = [...openPrs, ...closedPrs];

		for (const pr of prs) {
			if (pr.labelNames) {
				for (const label of pr.labelNames) {
					labelSet.add(label);
				}
			}
		}

		return [...labelSet].sort();
	}),
);

// ---------------------------------------------------------------------------
// List assignable users for a repository (from synced permissions)
// ---------------------------------------------------------------------------

const RepoCollaboratorSchema = Schema.Struct({
	login: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
});

const listRepoAssigneesDef = factory
	.query({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
		},
		success: Schema.Array(RepoCollaboratorSchema),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

listRepoAssigneesDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return [];

		const ctx = yield* ConfectQueryCtx;

		// Get all users with permissions on this repo
		const permissions = yield* ctx.db
			.query("github_user_repo_permissions")
			.withIndex("by_repositoryId", (q) => q.eq("repositoryId", repositoryId))
			.collect();

		const userIds = [...new Set(permissions.map((perm) => perm.githubUserId))];
		const users = yield* Effect.forEach(
			userIds,
			(userId) =>
				ctx.db
					.query("github_users")
					.withIndex("by_githubUserId", (q) => q.eq("githubUserId", userId))
					.first(),
			{ concurrency: QUERY_ENRICH_CONCURRENCY_LIMIT },
		);

		const userByGitHubId = new Map<
			number,
			{ login: string; avatarUrl: string | null }
		>();
		for (const userOption of users) {
			if (Option.isNone(userOption)) continue;
			userByGitHubId.set(userOption.value.githubUserId, {
				login: userOption.value.login,
				avatarUrl: userOption.value.avatarUrl,
			});
		}

		const collaborators = permissions.map((perm) => {
			const user = userByGitHubId.get(perm.githubUserId);
			return user === undefined ? null : user;
		});

		return collaborators
			.filter(
				(c): c is { login: string; avatarUrl: string | null } => c !== null,
			)
			.sort((a, b) => a.login.localeCompare(b.login));
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const projectionQueriesModule = makeRpcModule(
	{
		listRepos: listReposDef,
		searchRepos: searchReposDef,
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
		searchIssuesAndPrs: searchIssuesAndPrsDef,
		listRepoLabels: listRepoLabelsDef,
		listRepoAssignees: listRepoAssigneesDef,
	},
	{ middlewares: DatabaseRpcModuleMiddlewares },
);

export const {
	listRepos,
	searchRepos,
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
	searchIssuesAndPrs,
	listRepoLabels,
	listRepoAssignees,
} = projectionQueriesModule.handlers;
export { projectionQueriesModule };
export type ProjectionQueriesModule = typeof projectionQueriesModule;
