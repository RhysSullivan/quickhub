import {
	Cursor,
	PaginationOptionsSchema,
	PaginationResultSchema,
} from "@packages/confect";
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { internal } from "../_generated/api";
import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	confectSchema,
} from "../confect";
import { GitHubApiClient } from "../shared/githubApi";
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
// Implementations
// ---------------------------------------------------------------------------

listReposDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		// Bounded — personal dashboard should have <100 repos
		const overviews = yield* ctx.db.query("view_repo_overview").take(100);
		return overviews.map((o) => ({
			repositoryId: o.repositoryId,
			fullName: o.fullName,
			ownerLogin: o.ownerLogin,
			name: o.name,
			openPrCount: o.openPrCount,
			openIssueCount: o.openIssueCount,
			failingCheckCount: o.failingCheckCount,
			lastPushAt: o.lastPushAt,
			updatedAt: o.updatedAt,
		}));
	}),
);

getRepoOverviewDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		// Look up repo by owner/name to get repositoryId
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repo)) return null;

		const overview = yield* ctx.db
			.query("view_repo_overview")
			.withIndex("by_repositoryId", (q) =>
				q.eq("repositoryId", repo.value.githubRepoId),
			)
			.first();

		if (Option.isNone(overview)) return null;

		const o = overview.value;
		return {
			repositoryId: o.repositoryId,
			fullName: o.fullName,
			ownerLogin: o.ownerLogin,
			name: o.name,
			openPrCount: o.openPrCount,
			openIssueCount: o.openIssueCount,
			failingCheckCount: o.failingCheckCount,
			lastPushAt: o.lastPushAt,
			updatedAt: o.updatedAt,
		};
	}),
);

getSyncProgressDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		// Look up the repo to get its githubRepoId
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repo)) return null;

		const repositoryId = repo.value.githubRepoId;
		const installationId = repo.value.installationId;

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

listPullRequestsDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return [];

		const ctx = yield* ConfectQueryCtx;

		const state = args.state;
		const query =
			state !== undefined
				? ctx.db
						.query("view_repo_pull_request_list")
						.withIndex("by_repositoryId_and_state_and_sortUpdated", (q) =>
							q.eq("repositoryId", repositoryId).eq("state", state),
						)
						.order("desc")
				: ctx.db
						.query("view_repo_pull_request_list")
						.withIndex("by_repositoryId_and_sortUpdated", (q) =>
							q.eq("repositoryId", repositoryId),
						)
						.order("desc");

		// Bounded to prevent unbounded queries on large repos
		const prs = yield* query.take(200);

		return prs.map((pr) => ({
			number: pr.number,
			state: pr.state,
			draft: pr.draft,
			title: pr.title,
			authorLogin: pr.authorLogin,
			authorAvatarUrl: pr.authorAvatarUrl,
			headRefName: pr.headRefName,
			baseRefName: pr.baseRefName,
			commentCount: pr.commentCount,
			reviewCount: pr.reviewCount,
			lastCheckConclusion: pr.lastCheckConclusion,
			githubUpdatedAt: pr.githubUpdatedAt,
		}));
	}),
);

listIssuesDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return [];

		const ctx = yield* ConfectQueryCtx;

		const state = args.state;
		const query =
			state !== undefined
				? ctx.db
						.query("view_repo_issue_list")
						.withIndex("by_repositoryId_and_state_and_sortUpdated", (q) =>
							q.eq("repositoryId", repositoryId).eq("state", state),
						)
						.order("desc")
				: ctx.db
						.query("view_repo_issue_list")
						.withIndex("by_repositoryId_and_sortUpdated", (q) =>
							q.eq("repositoryId", repositoryId),
						)
						.order("desc");

		// Bounded to prevent unbounded queries on large repos
		const issues = yield* query.take(200);

		return issues.map((i) => ({
			number: i.number,
			state: i.state,
			title: i.title,
			authorLogin: i.authorLogin,
			authorAvatarUrl: i.authorAvatarUrl,
			labelNames: [...i.labelNames],
			commentCount: i.commentCount,
			githubUpdatedAt: i.githubUpdatedAt,
		}));
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
			.withIndex("by_fullName", (q) =>
				q.eq("fullName", `${args.ownerLogin}/${args.name}`),
			)
			.first();

		if (Option.isNone(repo)) return { scheduled: false };

		const repositoryId = repo.value.githubRepoId;

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
		// Need the repo's connectedByUserId for the GitHub token
		const connectedByUserId = repo.value.connectedByUserId;
		if (!connectedByUserId) return { scheduled: false };

		yield* Effect.promise(() =>
			ctx.scheduler.runAfter(0, internal.rpc.githubActions.syncPrFiles, {
				ownerLogin: args.ownerLogin,
				name: args.name,
				repositoryId,
				pullRequestNumber: args.number,
				headSha,
				connectedByUserId,
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
						.query("view_repo_pull_request_list")
						.withIndex("by_repositoryId_and_state_and_sortUpdated", (q) =>
							q.eq("repositoryId", repositoryId).eq("state", state),
						)
						.order("desc")
				: ctx.db
						.query("view_repo_pull_request_list")
						.withIndex("by_repositoryId_and_sortUpdated", (q) =>
							q.eq("repositoryId", repositoryId),
						)
						.order("desc");

		const result = yield* query.paginate(paginationOpts);

		return {
			page: result.page.map((pr) => ({
				number: pr.number,
				state: pr.state,
				draft: pr.draft,
				title: pr.title,
				authorLogin: pr.authorLogin,
				authorAvatarUrl: pr.authorAvatarUrl,
				headRefName: pr.headRefName,
				baseRefName: pr.baseRefName,
				commentCount: pr.commentCount,
				reviewCount: pr.reviewCount,
				lastCheckConclusion: pr.lastCheckConclusion,
				githubUpdatedAt: pr.githubUpdatedAt,
			})),
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
						.query("view_repo_issue_list")
						.withIndex("by_repositoryId_and_state_and_sortUpdated", (q) =>
							q.eq("repositoryId", repositoryId).eq("state", state),
						)
						.order("desc")
				: ctx.db
						.query("view_repo_issue_list")
						.withIndex("by_repositoryId_and_sortUpdated", (q) =>
							q.eq("repositoryId", repositoryId),
						)
						.order("desc");

		const result = yield* query.paginate(paginationOpts);

		return {
			page: result.page.map((i) => ({
				number: i.number,
				state: i.state,
				title: i.title,
				authorLogin: i.authorLogin,
				authorAvatarUrl: i.authorAvatarUrl,
				labelNames: [...i.labelNames],
				commentCount: i.commentCount,
				githubUpdatedAt: i.githubUpdatedAt,
			})),
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

listWorkflowRunsDef.implement((args) =>
	Effect.gen(function* () {
		const repositoryId = yield* findRepo(args.ownerLogin, args.name);
		if (repositoryId === null) return [];

		const ctx = yield* ConfectQueryCtx;

		const runs = yield* ctx.db
			.query("view_repo_workflow_run_list")
			.withIndex("by_repositoryId_and_sortUpdated", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.order("desc")
			.take(200);

		return runs.map((r) => ({
			githubRunId: r.githubRunId,
			workflowName: r.workflowName,
			runNumber: r.runNumber,
			event: r.event,
			status: r.status,
			conclusion: r.conclusion,
			headBranch: r.headBranch,
			headSha: r.headSha,
			actorLogin: r.actorLogin,
			actorAvatarUrl: r.actorAvatarUrl,
			jobCount: r.jobCount,
			htmlUrl: r.htmlUrl,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}));
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
			.query("view_repo_workflow_run_list")
			.withIndex("by_repositoryId_and_sortUpdated", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.order("desc")
			.paginate(paginationOpts);

		return {
			page: result.page.map((r) => ({
				githubRunId: r.githubRunId,
				workflowName: r.workflowName,
				runNumber: r.runNumber,
				event: r.event,
				status: r.status,
				conclusion: r.conclusion,
				headBranch: r.headBranch,
				headSha: r.headSha,
				actorLogin: r.actorLogin,
				actorAvatarUrl: r.actorAvatarUrl,
				jobCount: r.jobCount,
				htmlUrl: r.htmlUrl,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
			})),
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
} = projectionQueriesModule.handlers;
export { projectionQueriesModule };
export type ProjectionQueriesModule = typeof projectionQueriesModule;
