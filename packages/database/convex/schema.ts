import { defineSchema, defineTable } from "@packages/confect/schema";
import { Schema } from "effect";

// ============================================================
// A) Control + Ingestion Tables
// ============================================================

const GitHubInstallationSchema = Schema.Struct({
	installationId: Schema.Number,
	accountId: Schema.Number,
	accountLogin: Schema.String,
	accountType: Schema.Literal("User", "Organization"),
	suspendedAt: Schema.NullOr(Schema.Number),
	permissionsDigest: Schema.String,
	eventsDigest: Schema.String,
	updatedAt: Schema.Number,
});

const GitHubSyncJobSchema = Schema.Struct({
	jobType: Schema.Literal("backfill", "reconcile", "replay"),
	scopeType: Schema.Literal("installation", "repository", "entity"),
	triggerReason: Schema.Literal(
		"install",
		"repo_added",
		"manual",
		"reconcile",
		"replay",
	),
	lockKey: Schema.String,
	installationId: Schema.NullOr(Schema.Number),
	repositoryId: Schema.NullOr(Schema.Number),
	entityType: Schema.NullOr(Schema.String),
	state: Schema.Literal("pending", "running", "retry", "done", "failed"),
	attemptCount: Schema.Number,
	nextRunAt: Schema.Number,
	lastError: Schema.NullOr(Schema.String),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});

const GitHubSyncCursorSchema = Schema.Struct({
	cursorKey: Schema.String,
	cursorValue: Schema.NullOr(Schema.String),
	watermarkAt: Schema.NullOr(Schema.Number),
	updatedAt: Schema.Number,
});

const GitHubWebhookEventRawSchema = Schema.Struct({
	deliveryId: Schema.String,
	eventName: Schema.String,
	action: Schema.NullOr(Schema.String),
	installationId: Schema.NullOr(Schema.Number),
	repositoryId: Schema.NullOr(Schema.Number),
	signatureValid: Schema.Boolean,
	payloadJson: Schema.String,
	receivedAt: Schema.Number,
	processState: Schema.Literal("pending", "processed", "failed", "retry"),
	processError: Schema.NullOr(Schema.String),
	processAttempts: Schema.Number,
	nextRetryAt: Schema.NullOr(Schema.Number),
});

const GitHubDeadLetterSchema = Schema.Struct({
	deliveryId: Schema.String,
	reason: Schema.String,
	payloadJson: Schema.String,
	createdAt: Schema.Number,
});

const GitHubWriteOperationSchema = Schema.Struct({
	/** Unique client-generated ID for deduplication & correlation */
	correlationId: Schema.String,
	/** Type of write operation */
	operationType: Schema.Literal(
		"create_issue",
		"create_comment",
		"update_issue_state",
		"merge_pull_request",
	),
	/** pending → completed/failed → confirmed (webhook received) */
	state: Schema.Literal("pending", "completed", "failed", "confirmed"),
	/** Repo coordinates */
	repositoryId: Schema.Number,
	ownerLogin: Schema.String,
	repoName: Schema.String,
	/** Original input arguments as JSON */
	inputPayloadJson: Schema.String,
	/** Optimistic data the UI can display while pending (e.g. issue title, body preview) */
	optimisticDataJson: Schema.NullOr(Schema.String),
	/** GitHub API response data filled on completion */
	resultDataJson: Schema.NullOr(Schema.String),
	/** Error message filled on failure */
	errorMessage: Schema.NullOr(Schema.String),
	/** HTTP status code from GitHub on failure */
	errorStatus: Schema.NullOr(Schema.Number),
	/** GitHub entity number (issue/PR number) — filled on completion, used for webhook matching */
	githubEntityNumber: Schema.NullOr(Schema.Number),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});

// ============================================================
// B) Normalized Domain Tables
// ============================================================

const GitHubUserSchema = Schema.Struct({
	githubUserId: Schema.Number,
	login: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	siteAdmin: Schema.Boolean,
	type: Schema.Literal("User", "Bot", "Organization"),
	updatedAt: Schema.Number,
});

const GitHubOrganizationSchema = Schema.Struct({
	githubOrgId: Schema.Number,
	login: Schema.String,
	name: Schema.NullOr(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
	updatedAt: Schema.Number,
});

const GitHubRepositorySchema = Schema.Struct({
	githubRepoId: Schema.Number,
	installationId: Schema.Number,
	ownerId: Schema.Number,
	ownerLogin: Schema.String,
	name: Schema.String,
	fullName: Schema.String,
	private: Schema.Boolean,
	visibility: Schema.Literal("public", "private", "internal"),
	defaultBranch: Schema.String,
	archived: Schema.Boolean,
	disabled: Schema.Boolean,
	fork: Schema.Boolean,
	pushedAt: Schema.NullOr(Schema.Number),
	githubUpdatedAt: Schema.Number,
	cachedAt: Schema.Number,
	/**
	 * The better-auth user ID of whoever connected this repo.
	 * Used to look up the user's GitHub OAuth token from the account table
	 * for background syncs (webhooks, bootstrap) that lack a user session.
	 * Only set when the connecting user has admin/webhook permissions.
	 */
	connectedByUserId: Schema.optional(Schema.NullOr(Schema.String)),
});

const GitHubBranchSchema = Schema.Struct({
	repositoryId: Schema.Number,
	name: Schema.String,
	headSha: Schema.String,
	protected: Schema.Boolean,
	updatedAt: Schema.Number,
});

const GitHubCommitSchema = Schema.Struct({
	repositoryId: Schema.Number,
	sha: Schema.String,
	authorUserId: Schema.NullOr(Schema.Number),
	committerUserId: Schema.NullOr(Schema.Number),
	messageHeadline: Schema.String,
	authoredAt: Schema.NullOr(Schema.Number),
	committedAt: Schema.NullOr(Schema.Number),
	additions: Schema.NullOr(Schema.Number),
	deletions: Schema.NullOr(Schema.Number),
	changedFiles: Schema.NullOr(Schema.Number),
	cachedAt: Schema.Number,
});

const GitHubPullRequestSchema = Schema.Struct({
	repositoryId: Schema.Number,
	githubPrId: Schema.Number,
	number: Schema.Number,
	state: Schema.Literal("open", "closed"),
	draft: Schema.Boolean,
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	authorUserId: Schema.NullOr(Schema.Number),
	assigneeUserIds: Schema.Array(Schema.Number),
	requestedReviewerUserIds: Schema.Array(Schema.Number),
	baseRefName: Schema.String,
	headRefName: Schema.String,
	headSha: Schema.String,
	mergeableState: Schema.NullOr(Schema.String),
	mergedAt: Schema.NullOr(Schema.Number),
	closedAt: Schema.NullOr(Schema.Number),
	githubUpdatedAt: Schema.Number,
	cachedAt: Schema.Number,
});

const GitHubPullRequestReviewSchema = Schema.Struct({
	repositoryId: Schema.Number,
	pullRequestNumber: Schema.Number,
	githubReviewId: Schema.Number,
	authorUserId: Schema.NullOr(Schema.Number),
	state: Schema.String,
	submittedAt: Schema.NullOr(Schema.Number),
	commitSha: Schema.NullOr(Schema.String),
});

const GitHubIssueSchema = Schema.Struct({
	repositoryId: Schema.Number,
	githubIssueId: Schema.Number,
	number: Schema.Number,
	state: Schema.Literal("open", "closed"),
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	authorUserId: Schema.NullOr(Schema.Number),
	assigneeUserIds: Schema.Array(Schema.Number),
	labelNames: Schema.Array(Schema.String),
	commentCount: Schema.Number,
	isPullRequest: Schema.Boolean,
	closedAt: Schema.NullOr(Schema.Number),
	githubUpdatedAt: Schema.Number,
	cachedAt: Schema.Number,
});

const GitHubIssueCommentSchema = Schema.Struct({
	repositoryId: Schema.Number,
	issueNumber: Schema.Number,
	githubCommentId: Schema.Number,
	authorUserId: Schema.NullOr(Schema.Number),
	body: Schema.String,
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});

const GitHubPullRequestFileSchema = Schema.Struct({
	repositoryId: Schema.Number,
	pullRequestNumber: Schema.Number,
	/** SHA of the PR head at the time files were fetched */
	headSha: Schema.String,
	/** File path (e.g. "src/index.ts") */
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
	/** Unified diff patch content — null for binary files or GitHub truncation */
	patch: Schema.NullOr(Schema.String),
	/** Previous filename for renames/copies */
	previousFilename: Schema.NullOr(Schema.String),
	cachedAt: Schema.Number,
});

const GitHubCheckRunSchema = Schema.Struct({
	repositoryId: Schema.Number,
	githubCheckRunId: Schema.Number,
	name: Schema.String,
	headSha: Schema.String,
	status: Schema.String,
	conclusion: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.Number),
	completedAt: Schema.NullOr(Schema.Number),
});

const GitHubWorkflowRunSchema = Schema.Struct({
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
	actorUserId: Schema.NullOr(Schema.Number),
	htmlUrl: Schema.NullOr(Schema.String),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});

const GitHubWorkflowJobSchema = Schema.Struct({
	repositoryId: Schema.Number,
	githubJobId: Schema.Number,
	githubRunId: Schema.Number,
	name: Schema.String,
	status: Schema.String,
	conclusion: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.Number),
	completedAt: Schema.NullOr(Schema.Number),
	runnerName: Schema.NullOr(Schema.String),
	/** Serialized JSON array of step objects */
	stepsJson: Schema.NullOr(Schema.String),
});

// ============================================================
// C) UI Read Projection Tables
// ============================================================

const ViewRepoOverviewSchema = Schema.Struct({
	repositoryId: Schema.Number,
	fullName: Schema.String,
	ownerLogin: Schema.String,
	name: Schema.String,
	openPrCount: Schema.Number,
	openIssueCount: Schema.Number,
	failingCheckCount: Schema.Number,
	lastPushAt: Schema.NullOr(Schema.Number),
	syncLagSeconds: Schema.NullOr(Schema.Number),
	updatedAt: Schema.Number,
});

const ViewRepoPullRequestListSchema = Schema.Struct({
	repositoryId: Schema.Number,
	githubPrId: Schema.Number,
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
	sortUpdated: Schema.Number,
});

const ViewRepoIssueListSchema = Schema.Struct({
	repositoryId: Schema.Number,
	githubIssueId: Schema.Number,
	number: Schema.Number,
	state: Schema.Literal("open", "closed"),
	title: Schema.String,
	authorLogin: Schema.NullOr(Schema.String),
	authorAvatarUrl: Schema.NullOr(Schema.String),
	labelNames: Schema.Array(Schema.String),
	commentCount: Schema.Number,
	githubUpdatedAt: Schema.Number,
	sortUpdated: Schema.Number,
});

const ViewRepoWorkflowRunListSchema = Schema.Struct({
	repositoryId: Schema.Number,
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
	sortUpdated: Schema.Number,
});

const ViewActivityFeedSchema = Schema.Struct({
	repositoryId: Schema.Number,
	installationId: Schema.Number,
	activityType: Schema.String,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	actorLogin: Schema.NullOr(Schema.String),
	actorAvatarUrl: Schema.NullOr(Schema.String),
	entityNumber: Schema.NullOr(Schema.Number),
	createdAt: Schema.Number,
});

// ============================================================
// Schema Definition
// ============================================================

export const confectSchema = defineSchema({
	// A) Control + Ingestion
	github_installations: defineTable(GitHubInstallationSchema)
		.index("by_installationId", ["installationId"])
		.index("by_accountLogin", ["accountLogin"]),

	github_sync_jobs: defineTable(GitHubSyncJobSchema)
		.index("by_lockKey", ["lockKey"])
		.index("by_state_and_nextRunAt", ["state", "nextRunAt"])
		.index("by_scopeType_and_installationId", ["scopeType", "installationId"]),

	github_sync_cursors: defineTable(GitHubSyncCursorSchema).index(
		"by_cursorKey",
		["cursorKey"],
	),

	github_webhook_events_raw: defineTable(GitHubWebhookEventRawSchema)
		.index("by_deliveryId", ["deliveryId"])
		.index("by_processState_and_receivedAt", ["processState", "receivedAt"])
		.index("by_processState_and_nextRetryAt", ["processState", "nextRetryAt"])
		.index("by_installationId_and_receivedAt", [
			"installationId",
			"receivedAt",
		]),

	github_dead_letters: defineTable(GitHubDeadLetterSchema).index(
		"by_createdAt",
		["createdAt"],
	),

	github_write_operations: defineTable(GitHubWriteOperationSchema)
		.index("by_correlationId", ["correlationId"])
		.index("by_repositoryId_and_state_and_createdAt", [
			"repositoryId",
			"state",
			"createdAt",
		])
		.index("by_repositoryId_and_operationType_and_githubEntityNumber", [
			"repositoryId",
			"operationType",
			"githubEntityNumber",
		]),

	// B) Normalized Domain
	github_users: defineTable(GitHubUserSchema)
		.index("by_githubUserId", ["githubUserId"])
		.index("by_login", ["login"]),

	github_organizations: defineTable(GitHubOrganizationSchema)
		.index("by_githubOrgId", ["githubOrgId"])
		.index("by_login", ["login"]),

	github_repositories: defineTable(GitHubRepositorySchema)
		.index("by_githubRepoId", ["githubRepoId"])
		.index("by_installationId_and_fullName", ["installationId", "fullName"])
		.index("by_ownerLogin_and_name", ["ownerLogin", "name"])
		.index("by_installationId_and_githubUpdatedAt", [
			"installationId",
			"githubUpdatedAt",
		]),

	github_branches: defineTable(GitHubBranchSchema)
		.index("by_repositoryId_and_name", ["repositoryId", "name"])
		.index("by_repositoryId_and_headSha", ["repositoryId", "headSha"]),

	github_commits: defineTable(GitHubCommitSchema)
		.index("by_repositoryId_and_sha", ["repositoryId", "sha"])
		.index("by_repositoryId_and_committedAt", ["repositoryId", "committedAt"]),

	github_pull_requests: defineTable(GitHubPullRequestSchema)
		.index("by_repositoryId_and_number", ["repositoryId", "number"])
		.index("by_repositoryId_and_state_and_githubUpdatedAt", [
			"repositoryId",
			"state",
			"githubUpdatedAt",
		])
		.index("by_repositoryId_and_headSha", ["repositoryId", "headSha"]),

	github_pull_request_reviews: defineTable(GitHubPullRequestReviewSchema)
		.index("by_repositoryId_and_pullRequestNumber", [
			"repositoryId",
			"pullRequestNumber",
		])
		.index("by_repositoryId_and_githubReviewId", [
			"repositoryId",
			"githubReviewId",
		]),

	github_issues: defineTable(GitHubIssueSchema)
		.index("by_repositoryId_and_number", ["repositoryId", "number"])
		.index("by_repositoryId_and_state_and_githubUpdatedAt", [
			"repositoryId",
			"state",
			"githubUpdatedAt",
		]),

	github_issue_comments: defineTable(GitHubIssueCommentSchema)
		.index("by_repositoryId_and_issueNumber", ["repositoryId", "issueNumber"])
		.index("by_repositoryId_and_githubCommentId", [
			"repositoryId",
			"githubCommentId",
		]),

	github_pull_request_files: defineTable(GitHubPullRequestFileSchema)
		.index("by_repositoryId_and_pullRequestNumber_and_headSha", [
			"repositoryId",
			"pullRequestNumber",
			"headSha",
		])
		.index("by_repositoryId_and_pullRequestNumber_and_filename", [
			"repositoryId",
			"pullRequestNumber",
			"filename",
		]),

	github_check_runs: defineTable(GitHubCheckRunSchema)
		.index("by_repositoryId_and_githubCheckRunId", [
			"repositoryId",
			"githubCheckRunId",
		])
		.index("by_repositoryId_and_headSha", ["repositoryId", "headSha"]),

	github_workflow_runs: defineTable(GitHubWorkflowRunSchema)
		.index("by_repositoryId_and_githubRunId", ["repositoryId", "githubRunId"])
		.index("by_repositoryId_and_updatedAt", ["repositoryId", "updatedAt"]),

	github_workflow_jobs: defineTable(GitHubWorkflowJobSchema)
		.index("by_repositoryId_and_githubJobId", ["repositoryId", "githubJobId"])
		.index("by_repositoryId_and_githubRunId", ["repositoryId", "githubRunId"]),

	// C) UI Read Projections
	view_repo_overview: defineTable(ViewRepoOverviewSchema).index(
		"by_repositoryId",
		["repositoryId"],
	),

	view_repo_pull_request_list: defineTable(ViewRepoPullRequestListSchema)
		.index("by_repositoryId_and_sortUpdated", ["repositoryId", "sortUpdated"])
		.index("by_repositoryId_and_state_and_sortUpdated", [
			"repositoryId",
			"state",
			"sortUpdated",
		])
		.index("by_repositoryId_and_number", ["repositoryId", "number"]),

	view_repo_issue_list: defineTable(ViewRepoIssueListSchema)
		.index("by_repositoryId_and_sortUpdated", ["repositoryId", "sortUpdated"])
		.index("by_repositoryId_and_state_and_sortUpdated", [
			"repositoryId",
			"state",
			"sortUpdated",
		])
		.index("by_repositoryId_and_number", ["repositoryId", "number"]),

	view_repo_workflow_run_list: defineTable(ViewRepoWorkflowRunListSchema)
		.index("by_repositoryId_and_sortUpdated", ["repositoryId", "sortUpdated"])
		.index("by_repositoryId_and_conclusion_and_sortUpdated", [
			"repositoryId",
			"conclusion",
			"sortUpdated",
		])
		.index("by_repositoryId_and_githubRunId", ["repositoryId", "githubRunId"]),

	view_activity_feed: defineTable(ViewActivityFeedSchema)
		.index("by_repositoryId_and_createdAt", ["repositoryId", "createdAt"])
		.index("by_installationId_and_createdAt", ["installationId", "createdAt"]),
});

export default confectSchema.convexSchemaDefinition;
