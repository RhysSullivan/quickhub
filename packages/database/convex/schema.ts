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
	/** Human-readable label of the step currently executing (e.g. "Fetching pull requests") */
	currentStep: Schema.optional(Schema.NullOr(Schema.String)),
	/** Ordered list of steps that have completed so far */
	completedSteps: Schema.optional(Schema.Array(Schema.String)),
	/** Running count of items fetched across all completed steps */
	itemsFetched: Schema.optional(Schema.Number),
	/**
	 * Queue priority key where lower values are dequeued first.
	 * Uses negative stargazer count so higher-star repos run earlier.
	 */
	prioritySortKey: Schema.optional(Schema.Number),
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
	/** Discriminates where the dead letter originated from. */
	source: Schema.optionalWith(
		Schema.Literal("webhook", "bootstrap", "replay"),
		{ default: () => "webhook" },
	),
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
	stargazersCount: Schema.optional(Schema.Number),
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
	labelNames: Schema.optional(Schema.Array(Schema.String)),
	baseRefName: Schema.String,
	headRefName: Schema.String,
	headSha: Schema.String,
	mergeableState: Schema.NullOr(Schema.String),
	mergedAt: Schema.NullOr(Schema.Number),
	closedAt: Schema.NullOr(Schema.Number),
	githubUpdatedAt: Schema.Number,
	cachedAt: Schema.Number,
	optimisticCorrelationId: Schema.optional(Schema.NullOr(Schema.String)),
	optimisticOperationType: Schema.optional(
		Schema.NullOr(
			Schema.Literal(
				"update_issue_state",
				"merge_pull_request",
				"update_pull_request_branch",
				"update_labels",
				"update_assignees",
			),
		),
	),
	optimisticState: Schema.optional(
		Schema.NullOr(Schema.Literal("pending", "failed", "confirmed")),
	),
	optimisticErrorMessage: Schema.optional(Schema.NullOr(Schema.String)),
	optimisticErrorStatus: Schema.optional(Schema.NullOr(Schema.Number)),
	optimisticUpdatedAt: Schema.optional(Schema.NullOr(Schema.Number)),
	optimisticPayloadJson: Schema.optional(Schema.NullOr(Schema.String)),
});

const GitHubPullRequestReviewSchema = Schema.Struct({
	repositoryId: Schema.Number,
	pullRequestNumber: Schema.Number,
	githubReviewId: Schema.Number,
	authorUserId: Schema.NullOr(Schema.Number),
	state: Schema.String,
	submittedAt: Schema.NullOr(Schema.Number),
	commitSha: Schema.NullOr(Schema.String),
	optimisticCorrelationId: Schema.optional(Schema.NullOr(Schema.String)),
	optimisticOperationType: Schema.optional(
		Schema.NullOr(Schema.Literal("submit_pr_review")),
	),
	optimisticState: Schema.optional(
		Schema.NullOr(Schema.Literal("pending", "failed", "confirmed")),
	),
	optimisticErrorMessage: Schema.optional(Schema.NullOr(Schema.String)),
	optimisticErrorStatus: Schema.optional(Schema.NullOr(Schema.Number)),
	optimisticUpdatedAt: Schema.optional(Schema.NullOr(Schema.Number)),
	optimisticPayloadJson: Schema.optional(Schema.NullOr(Schema.String)),
});

const GitHubPullRequestReviewCommentSchema = Schema.Struct({
	repositoryId: Schema.Number,
	pullRequestNumber: Schema.Number,
	githubReviewCommentId: Schema.Number,
	githubReviewId: Schema.NullOr(Schema.Number),
	inReplyToGithubReviewCommentId: Schema.NullOr(Schema.Number),
	authorUserId: Schema.NullOr(Schema.Number),
	body: Schema.String,
	path: Schema.NullOr(Schema.String),
	line: Schema.NullOr(Schema.Number),
	originalLine: Schema.NullOr(Schema.Number),
	startLine: Schema.NullOr(Schema.Number),
	side: Schema.NullOr(Schema.String),
	startSide: Schema.NullOr(Schema.String),
	commitSha: Schema.NullOr(Schema.String),
	originalCommitSha: Schema.NullOr(Schema.String),
	htmlUrl: Schema.NullOr(Schema.String),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
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
	optimisticCorrelationId: Schema.optional(Schema.NullOr(Schema.String)),
	optimisticOperationType: Schema.optional(
		Schema.NullOr(
			Schema.Literal(
				"create_issue",
				"create_comment",
				"update_issue_state",
				"merge_pull_request",
				"update_labels",
				"update_assignees",
			),
		),
	),
	optimisticState: Schema.optional(
		Schema.NullOr(Schema.Literal("pending", "failed", "confirmed")),
	),
	optimisticErrorMessage: Schema.optional(Schema.NullOr(Schema.String)),
	optimisticErrorStatus: Schema.optional(Schema.NullOr(Schema.Number)),
	optimisticUpdatedAt: Schema.optional(Schema.NullOr(Schema.Number)),
	optimisticPayloadJson: Schema.optional(Schema.NullOr(Schema.String)),
});

const GitHubIssueCommentSchema = Schema.Struct({
	repositoryId: Schema.Number,
	issueNumber: Schema.Number,
	githubCommentId: Schema.Number,
	authorUserId: Schema.NullOr(Schema.Number),
	body: Schema.String,
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
	optimisticCorrelationId: Schema.optional(Schema.NullOr(Schema.String)),
	optimisticOperationType: Schema.optional(
		Schema.NullOr(Schema.Literal("create_comment")),
	),
	optimisticState: Schema.optional(
		Schema.NullOr(Schema.Literal("pending", "failed", "confirmed")),
	),
	optimisticErrorMessage: Schema.optional(Schema.NullOr(Schema.String)),
	optimisticErrorStatus: Schema.optional(Schema.NullOr(Schema.Number)),
	optimisticUpdatedAt: Schema.optional(Schema.NullOr(Schema.Number)),
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
// C) Permissions
// ============================================================

const GitHubUserRepoPermissionSchema = Schema.Struct({
	/** Better Auth user ID */
	userId: Schema.String,
	/** GitHub repository ID (matches github_repositories.githubRepoId) */
	repositoryId: Schema.Number,
	/** GitHub user ID (for cross-referencing) */
	githubUserId: Schema.Number,
	/** Read access */
	pull: Schema.Boolean,
	/** Manage issues/PRs without write access */
	triage: Schema.Boolean,
	/** Write — push code, manage issues/PRs */
	push: Schema.Boolean,
	/** Manage settings without destructive access */
	maintain: Schema.Boolean,
	/** Full access */
	admin: Schema.Boolean,
	/** Role name as returned by GitHub API */
	roleName: Schema.NullOr(Schema.String),
	/** When this permission was last synced from GitHub */
	syncedAt: Schema.Number,
});

// ============================================================
// D) Activity Feed (append-only event log)
// ============================================================

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
// E) Notifications (polled from GitHub per-user)
// ============================================================

const GitHubNotificationSchema = Schema.Struct({
	/** Better Auth user ID */
	userId: Schema.String,
	/** GitHub notification ID (unique per user) */
	githubNotificationId: Schema.String,
	/** Repository full name */
	repositoryFullName: Schema.String,
	repositoryId: Schema.NullOr(Schema.Number),
	/** Subject info */
	subjectTitle: Schema.String,
	subjectType: Schema.Literal(
		"Issue",
		"PullRequest",
		"Release",
		"Commit",
		"Discussion",
		"CheckSuite",
		"RepositoryVulnerabilityAlert",
		"RepositoryDependabotAlertsThread",
	),
	subjectUrl: Schema.NullOr(Schema.String),
	/** Reason for notification */
	reason: Schema.Literal(
		"assign",
		"author",
		"ci_activity",
		"comment",
		"manual",
		"mention",
		"push",
		"review_requested",
		"security_alert",
		"state_change",
		"subscribed",
		"team_mention",
		"approval_requested",
	),
	unread: Schema.Boolean,
	updatedAt: Schema.Number,
	lastReadAt: Schema.NullOr(Schema.Number),
	/** Entity number parsed from subject URL (e.g. issue/PR number) */
	entityNumber: Schema.NullOr(Schema.Number),
});

// ============================================================
// F) Code Cache (on-demand file tree + content)
// ============================================================

const GitHubTreeCacheSchema = Schema.Struct({
	repositoryId: Schema.Number,
	/** Cache key: the ref or SHA used to look up this tree (e.g. "HEAD", "main", or tree SHA) */
	sha: Schema.String,
	/** The actual tree object SHA resolved by GitHub — may differ from `sha` when cached by ref */
	resolvedTreeSha: Schema.optional(Schema.String),
	/** JSON-serialized tree array from GitHub API */
	treeJson: Schema.String,
	/** Whether the tree was truncated by GitHub */
	truncated: Schema.Boolean,
	cachedAt: Schema.Number,
});

const GitHubFileCacheSchema = Schema.Struct({
	repositoryId: Schema.Number,
	/** Git blob SHA — immutable, so this is the cache key */
	sha: Schema.String,
	/** File path for display */
	path: Schema.String,
	/** File content (UTF-8 text; null for binary) */
	content: Schema.NullOr(Schema.String),
	/** File size in bytes */
	size: Schema.Number,
	/** Encoding returned by GitHub */
	encoding: Schema.NullOr(Schema.String),
	cachedAt: Schema.Number,
});

// ============================================================
// G) Issue Template Cache
// ============================================================

const GitHubIssueTemplateCacheSchema = Schema.Struct({
	repositoryId: Schema.Number,
	/** Template filename (e.g. "bug_report.md") */
	filename: Schema.String,
	/** Display name from YAML front matter */
	name: Schema.String,
	/** Description from YAML front matter */
	description: Schema.String,
	/** Title prefix/template from YAML front matter */
	title: Schema.NullOr(Schema.String),
	/** Markdown body (below front matter) */
	body: Schema.String,
	/** Labels to auto-apply from YAML front matter */
	labels: Schema.Array(Schema.String),
	/** Assignees from YAML front matter */
	assignees: Schema.Array(Schema.String),
	cachedAt: Schema.Number,
});

const GitHubFileReadStateSchema = Schema.Struct({
	userId: Schema.String,
	repositoryId: Schema.Number,
	treeSha: Schema.String,
	path: Schema.String,
	fileSha: Schema.String,
	readAt: Schema.Number,
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
		.index("by_scopeType_and_installationId", ["scopeType", "installationId"])
		.index("by_installationId_and_state", ["installationId", "state"])
		.index("by_installationId_and_state_and_prioritySortKey_and_createdAt", [
			"installationId",
			"state",
			"prioritySortKey",
			"createdAt",
		]),

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

	github_dead_letters: defineTable(GitHubDeadLetterSchema)
		.index("by_createdAt", ["createdAt"])
		.index("by_source_and_createdAt", ["source", "createdAt"]),

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
		.index("by_optimisticCorrelationId", ["optimisticCorrelationId"])
		.index("by_repositoryId_and_state_and_githubUpdatedAt", [
			"repositoryId",
			"state",
			"githubUpdatedAt",
		])
		.index("by_repositoryId_and_headSha", ["repositoryId", "headSha"])
		.searchIndex("search_title", {
			searchField: "title",
			filterFields: ["repositoryId", "state"],
		}),

	github_pull_request_reviews: defineTable(GitHubPullRequestReviewSchema)
		.index("by_repositoryId_and_pullRequestNumber", [
			"repositoryId",
			"pullRequestNumber",
		])
		.index("by_optimisticCorrelationId", ["optimisticCorrelationId"])
		.index("by_repositoryId_and_githubReviewId", [
			"repositoryId",
			"githubReviewId",
		]),

	github_pull_request_review_comments: defineTable(
		GitHubPullRequestReviewCommentSchema,
	)
		.index("by_repositoryId_and_pullRequestNumber", [
			"repositoryId",
			"pullRequestNumber",
		])
		.index("by_repositoryId_and_githubReviewCommentId", [
			"repositoryId",
			"githubReviewCommentId",
		]),

	github_issues: defineTable(GitHubIssueSchema)
		.index("by_repositoryId_and_number", ["repositoryId", "number"])
		.index("by_optimisticCorrelationId", ["optimisticCorrelationId"])
		.index("by_repositoryId_and_state_and_githubUpdatedAt", [
			"repositoryId",
			"state",
			"githubUpdatedAt",
		])
		.searchIndex("search_title", {
			searchField: "title",
			filterFields: ["repositoryId", "state"],
		}),

	github_issue_comments: defineTable(GitHubIssueCommentSchema)
		.index("by_repositoryId_and_issueNumber", ["repositoryId", "issueNumber"])
		.index("by_optimisticCorrelationId", ["optimisticCorrelationId"])
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
		.index("by_repositoryId_and_runNumber", ["repositoryId", "runNumber"])
		.index("by_repositoryId_and_headSha", ["repositoryId", "headSha"])
		.index("by_repositoryId_and_updatedAt", ["repositoryId", "updatedAt"]),

	github_workflow_jobs: defineTable(GitHubWorkflowJobSchema)
		.index("by_repositoryId_and_githubJobId", ["repositoryId", "githubJobId"])
		.index("by_repositoryId_and_githubRunId", ["repositoryId", "githubRunId"]),

	// C) Permissions
	github_user_repo_permissions: defineTable(GitHubUserRepoPermissionSchema)
		.index("by_userId_and_repositoryId", ["userId", "repositoryId"])
		.index("by_repositoryId", ["repositoryId"])
		.index("by_userId", ["userId"])
		.index("by_userId_and_syncedAt", ["userId", "syncedAt"])
		.index("by_syncedAt", ["syncedAt"]),

	// D) Activity Feed (append-only event log — not a materialized projection)
	view_activity_feed: defineTable(ViewActivityFeedSchema)
		.index("by_repositoryId_and_createdAt", ["repositoryId", "createdAt"])
		.index("by_installationId_and_createdAt", ["installationId", "createdAt"]),

	// E) Notifications
	github_notifications: defineTable(GitHubNotificationSchema)
		.index("by_userId_and_updatedAt", ["userId", "updatedAt"])
		.index("by_userId_and_unread", ["userId", "unread"])
		.index("by_userId_and_githubNotificationId", [
			"userId",
			"githubNotificationId",
		]),

	// F) Code Cache
	github_tree_cache: defineTable(GitHubTreeCacheSchema).index(
		"by_repositoryId_and_sha",
		["repositoryId", "sha"],
	),

	github_file_cache: defineTable(GitHubFileCacheSchema).index(
		"by_repositoryId_and_sha",
		["repositoryId", "sha"],
	),

	// G) Issue Template Cache
	github_issue_template_cache: defineTable(GitHubIssueTemplateCacheSchema)
		.index("by_repositoryId", ["repositoryId"])
		.index("by_repositoryId_and_filename", ["repositoryId", "filename"]),

	github_file_read_state: defineTable(GitHubFileReadStateSchema)
		.index("by_userId_and_repositoryId", ["userId", "repositoryId"])
		.index("by_userId_and_repositoryId_and_treeSha", [
			"userId",
			"repositoryId",
			"treeSha",
		])
		.index("by_userId_and_repositoryId_and_treeSha_and_fileSha", [
			"userId",
			"repositoryId",
			"treeSha",
			"fileSha",
		]),
});

export default confectSchema.convexSchemaDefinition;
