import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import {
	Array as Arr,
	Effect,
	Either,
	Match,
	Option,
	Predicate,
	Schema,
} from "effect";
import { components, internal } from "../_generated/api";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";
import {
	syncCheckRunInsert,
	syncCheckRunReplace,
	syncCommentDelete,
	syncCommentInsert,
	syncCommentReplace,
	syncIssueInsert,
	syncIssueReplace,
	syncJobInsert,
	syncJobReplace,
	syncPrInsert,
	syncPrReplace,
	syncReviewInsert,
	syncReviewReplace,
	syncWebhookDelete,
	syncWebhookReplace,
} from "../shared/aggregateSync";
import { webhooksByState } from "../shared/aggregates";
import {
	toTrueBoolean as bool,
	toNumberOrNull as num,
	toObjectRecord as obj,
	toStringOrNull as str,
	toOpenClosedState,
} from "../shared/coerce";
import { appendActivityFeedEntry } from "../shared/projections";
import { parseIsoToMsOrNull as isoToMs } from "../shared/time";
import { DatabaseRpcModuleMiddlewares } from "./moduleMiddlewares";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Helpers — extract typed fields from untyped payloads
// ---------------------------------------------------------------------------

const WebhookUserSchema = Schema.Struct({
	id: Schema.Number,
	login: Schema.String,
	avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
	site_admin: Schema.optional(Schema.Boolean),
	type: Schema.optional(Schema.Literal("User", "Bot", "Organization")),
});

const decodeWebhookUser = Schema.decodeUnknownEither(WebhookUserSchema);

const InstallationRepositorySchema = Schema.Struct({
	id: Schema.Number,
	full_name: Schema.String,
	private: Schema.Boolean,
	default_branch: Schema.optional(Schema.String),
	stargazers_count: Schema.optional(Schema.Number),
});

const decodeInstallationRepository = Schema.decodeUnknownEither(
	InstallationRepositorySchema,
);

type InstallationRepository = Schema.Schema.Type<
	typeof InstallationRepositorySchema
>;

const parseInstallationRepositories = <A>(
	value: A,
): Array<InstallationRepository> => {
	if (!Array.isArray(value)) return [];
	const parsed: Array<InstallationRepository> = [];
	for (const entry of value) {
		const decoded = decodeInstallationRepository(entry);
		if (Either.isRight(decoded)) {
			parsed.push(decoded.right);
		}
	}
	return parsed;
};

/**
 * Extract a GitHub user object from a payload field.
 * Returns { githubUserId, login, avatarUrl, siteAdmin, type } or null.
 */
const extractUser = <A>(
	u: A,
): {
	githubUserId: number;
	login: string;
	avatarUrl: string | null;
	siteAdmin: boolean;
	type: "User" | "Bot" | "Organization";
} | null => {
	const decoded = decodeWebhookUser(u);
	if (Either.isLeft(decoded)) return null;
	return {
		githubUserId: decoded.right.id,
		login: decoded.right.login,
		avatarUrl: decoded.right.avatar_url ?? null,
		siteAdmin: decoded.right.site_admin ?? false,
		type: decoded.right.type ?? "User",
	};
};

// ---------------------------------------------------------------------------
// Per-user upsert helper (shared by all handlers)
// ---------------------------------------------------------------------------

const upsertUser = (user: NonNullable<ReturnType<typeof extractUser>>) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const existing = yield* ctx.db
			.query("github_users")
			.withIndex("by_githubUserId", (q) =>
				q.eq("githubUserId", user.githubUserId),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, {
				login: user.login,
				avatarUrl: user.avatarUrl,
				siteAdmin: user.siteAdmin,
				type: user.type,
				updatedAt: Date.now(),
			});
		} else {
			yield* ctx.db.insert("github_users", {
				...user,
				updatedAt: Date.now(),
			});
		}
	});

// ---------------------------------------------------------------------------
// Event handlers — each takes parsed payload + mutation context
// ---------------------------------------------------------------------------

/**
 * Handle `issues` events: opened, edited, closed, reopened, labeled, unlabeled, assigned, unassigned
 */
const handleIssuesEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		const action = str(payload.action);
		const issue = obj(payload.issue);
		const githubIssueId = num(issue.id);
		const issueNumber = num(issue.number);

		if (githubIssueId === null || issueNumber === null) return;

		// Upsert the issue author
		const authorUser = extractUser(issue.user);
		if (authorUser) yield* upsertUser(authorUser);

		// Extract labels
		const labels = Array.isArray(issue.labels)
			? Arr.filter(
					Arr.map(issue.labels, (labelInput) => {
						const label = obj(labelInput);
						return str(label.name);
					}),
					Predicate.isNotNull,
				)
			: [];

		// Extract assignee IDs
		const assigneeUserIds = Array.isArray(issue.assignees)
			? Arr.filter(
					Arr.map(issue.assignees, (assigneeInput) => {
						const user = extractUser(assigneeInput);
						return user?.githubUserId ?? null;
					}),
					Predicate.isNotNull,
				)
			: [];

		const githubUpdatedAt = isoToMs(issue.updated_at) ?? now;

		const data = {
			repositoryId,
			githubIssueId,
			number: issueNumber,
			state: toOpenClosedState(str(issue.state)),
			title: str(issue.title) ?? "",
			body: str(issue.body),
			authorUserId: authorUser?.githubUserId ?? null,
			assigneeUserIds,
			labelNames: labels,
			commentCount: num(issue.comments) ?? 0,
			isPullRequest: "pull_request" in issue,
			closedAt: isoToMs(issue.closed_at),
			githubUpdatedAt,
			cachedAt: now,
		};

		const existing = yield* ctx.db
			.query("github_issues")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId).eq("number", issueNumber),
			)
			.first();

		if (Option.isSome(existing)) {
			const shouldConfirmOptimistic =
				existing.value.optimisticState === "pending" &&
				((action === "opened" &&
					existing.value.optimisticOperationType === "create_issue") ||
					((action === "closed" || action === "reopened") &&
						existing.value.optimisticOperationType === "update_issue_state") ||
					((action === "labeled" || action === "unlabeled") &&
						existing.value.optimisticOperationType === "update_labels") ||
					((action === "assigned" || action === "unassigned") &&
						existing.value.optimisticOperationType === "update_assignees"));

			if (githubUpdatedAt >= existing.value.githubUpdatedAt) {
				yield* ctx.db.patch(existing.value._id, data);
				if (shouldConfirmOptimistic) {
					yield* ctx.db.patch(existing.value._id, {
						optimisticState: "confirmed",
						optimisticErrorMessage: null,
						optimisticErrorStatus: null,
						optimisticUpdatedAt: now,
					});
				}
				const updated = yield* ctx.db.get(existing.value._id);
				if (Option.isSome(updated)) {
					yield* syncIssueReplace(ctx.rawCtx, existing.value, updated.value);
				}
			} else if (shouldConfirmOptimistic) {
				yield* ctx.db.patch(existing.value._id, {
					optimisticState: "confirmed",
					optimisticErrorMessage: null,
					optimisticErrorStatus: null,
					optimisticUpdatedAt: now,
				});
				const updated = yield* ctx.db.get(existing.value._id);
				if (Option.isSome(updated)) {
					yield* syncIssueReplace(ctx.rawCtx, existing.value, updated.value);
				}
			}
		} else {
			const id = yield* ctx.db.insert("github_issues", data);
			const inserted = yield* ctx.db.get(id);
			if (Option.isSome(inserted)) {
				yield* syncIssueInsert(ctx.rawCtx, inserted.value);
			}
		}
	});

/**
 * Handle `pull_request` events: opened, closed, reopened, edited, synchronize, ready_for_review, etc.
 */
const handlePullRequestEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		const action = str(payload.action);
		const pr = obj(payload.pull_request);
		const githubPrId = num(pr.id);
		const prNumber = num(pr.number);

		if (githubPrId === null || prNumber === null) return;

		// Upsert author
		const authorUser = extractUser(pr.user);
		if (authorUser) yield* upsertUser(authorUser);

		const head = obj(pr.head);
		const base = obj(pr.base);

		// Extract assignee IDs
		const assigneeUserIds = Array.isArray(pr.assignees)
			? Arr.filter(
					Arr.map(pr.assignees, (assigneeInput) => {
						const user = extractUser(assigneeInput);
						return user?.githubUserId ?? null;
					}),
					Predicate.isNotNull,
				)
			: [];

		// Extract requested reviewer IDs
		const requestedReviewerUserIds = Array.isArray(pr.requested_reviewers)
			? Arr.filter(
					Arr.map(pr.requested_reviewers, (reviewerInput) => {
						const user = extractUser(reviewerInput);
						return user?.githubUserId ?? null;
					}),
					Predicate.isNotNull,
				)
			: [];

		// Extract labels
		const labelNames = Array.isArray(pr.labels)
			? Arr.filter(
					Arr.map(pr.labels, (labelInput) => {
						const label = obj(labelInput);
						return str(label.name);
					}),
					Predicate.isNotNull,
				)
			: [];

		const githubUpdatedAt = isoToMs(pr.updated_at) ?? now;

		const data = {
			repositoryId,
			githubPrId,
			number: prNumber,
			state: toOpenClosedState(str(pr.state)),
			draft: bool(pr.draft),
			title: str(pr.title) ?? "",
			body: str(pr.body),
			authorUserId: authorUser?.githubUserId ?? null,
			assigneeUserIds,
			requestedReviewerUserIds,
			labelNames,
			baseRefName: str(base.ref) ?? "",
			headRefName: str(head.ref) ?? "",
			headSha: str(head.sha) ?? "",
			mergeableState: str(pr.mergeable_state),
			mergedAt: isoToMs(pr.merged_at),
			closedAt: isoToMs(pr.closed_at),
			githubUpdatedAt,
			cachedAt: now,
		};

		const existing = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId).eq("number", prNumber),
			)
			.first();

		if (Option.isSome(existing)) {
			const shouldConfirmOptimistic =
				existing.value.optimisticState === "pending" &&
				((action === "closed" &&
					pr.merged === true &&
					existing.value.optimisticOperationType === "merge_pull_request") ||
					((action === "closed" || action === "reopened") &&
						existing.value.optimisticOperationType === "update_issue_state") ||
					((action === "labeled" || action === "unlabeled") &&
						existing.value.optimisticOperationType === "update_labels") ||
					((action === "assigned" || action === "unassigned") &&
						existing.value.optimisticOperationType === "update_assignees"));

			if (githubUpdatedAt >= existing.value.githubUpdatedAt) {
				yield* ctx.db.patch(existing.value._id, data);
				if (shouldConfirmOptimistic) {
					yield* ctx.db.patch(existing.value._id, {
						optimisticState: "confirmed",
						optimisticErrorMessage: null,
						optimisticErrorStatus: null,
						optimisticUpdatedAt: now,
					});
				}
				const updated = yield* ctx.db.get(existing.value._id);
				if (Option.isSome(updated)) {
					yield* syncPrReplace(ctx.rawCtx, existing.value, updated.value);
				}
			} else if (shouldConfirmOptimistic) {
				yield* ctx.db.patch(existing.value._id, {
					optimisticState: "confirmed",
					optimisticErrorMessage: null,
					optimisticErrorStatus: null,
					optimisticUpdatedAt: now,
				});
				const updated = yield* ctx.db.get(existing.value._id);
				if (Option.isSome(updated)) {
					yield* syncPrReplace(ctx.rawCtx, existing.value, updated.value);
				}
			}
		} else {
			const id = yield* ctx.db.insert("github_pull_requests", data);
			const inserted = yield* ctx.db.get(id);
			if (Option.isSome(inserted)) {
				yield* syncPrInsert(ctx.rawCtx, inserted.value);
			}
		}
	});

/**
 * Handle `issue_comment` events: created, edited, deleted
 */
const handleIssueCommentEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		const action = str(payload.action);
		const comment = obj(payload.comment);
		const issue = obj(payload.issue);
		const githubCommentId = num(comment.id);
		const issueNumber = num(issue.number);

		if (githubCommentId === null || issueNumber === null) return;

		// Upsert comment author
		const authorUser = extractUser(comment.user);
		if (authorUser) yield* upsertUser(authorUser);

		if (action === "deleted") {
			// Remove the comment
			const existing = yield* ctx.db
				.query("github_issue_comments")
				.withIndex("by_repositoryId_and_githubCommentId", (q) =>
					q
						.eq("repositoryId", repositoryId)
						.eq("githubCommentId", githubCommentId),
				)
				.first();
			if (Option.isSome(existing)) {
				yield* syncCommentDelete(ctx.rawCtx, existing.value);
				yield* ctx.db.delete(existing.value._id);
			}
			return;
		}

		// Upsert comment (created or edited)
		const data = {
			repositoryId,
			issueNumber,
			githubCommentId,
			authorUserId: authorUser?.githubUserId ?? null,
			body: str(comment.body) ?? "",
			createdAt: isoToMs(comment.created_at) ?? now,
			updatedAt: isoToMs(comment.updated_at) ?? now,
		};

		const existing = yield* ctx.db
			.query("github_issue_comments")
			.withIndex("by_repositoryId_and_githubCommentId", (q) =>
				q
					.eq("repositoryId", repositoryId)
					.eq("githubCommentId", githubCommentId),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, data);
			if (
				action === "created" &&
				existing.value.optimisticOperationType === "create_comment" &&
				existing.value.optimisticState === "pending"
			) {
				yield* ctx.db.patch(existing.value._id, {
					optimisticState: "confirmed",
					optimisticErrorMessage: null,
					optimisticErrorStatus: null,
					optimisticUpdatedAt: now,
				});
			}
			const updated = yield* ctx.db.get(existing.value._id);
			if (Option.isSome(updated)) {
				yield* syncCommentReplace(ctx.rawCtx, existing.value, updated.value);
			}
		} else {
			const id = yield* ctx.db.insert("github_issue_comments", data);
			const inserted = yield* ctx.db.get(id);
			if (Option.isSome(inserted)) {
				yield* syncCommentInsert(ctx.rawCtx, inserted.value);
			}
		}
	});

/**
 * Handle `push` events — update branch head SHA + extract commits
 */
const handlePushEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		const ref = str(payload.ref);
		const after = str(payload.after);

		if (!ref || !after) return;

		// ref is like "refs/heads/main" — extract branch name
		const branchPrefix = "refs/heads/";
		if (!ref.startsWith(branchPrefix)) return;
		const branchName = ref.slice(branchPrefix.length);

		// Check if branch was deleted (after is all zeros)
		const deleted = bool(payload.deleted);
		if (deleted) {
			const existing = yield* ctx.db
				.query("github_branches")
				.withIndex("by_repositoryId_and_name", (q) =>
					q.eq("repositoryId", repositoryId).eq("name", branchName),
				)
				.first();
			if (Option.isSome(existing)) {
				yield* ctx.db.delete(existing.value._id);
			}
			return;
		}

		// Upsert branch with new head SHA
		const existingBranch = yield* ctx.db
			.query("github_branches")
			.withIndex("by_repositoryId_and_name", (q) =>
				q.eq("repositoryId", repositoryId).eq("name", branchName),
			)
			.first();

		if (Option.isSome(existingBranch)) {
			yield* ctx.db.patch(existingBranch.value._id, {
				headSha: after,
				updatedAt: now,
			});
		} else {
			yield* ctx.db.insert("github_branches", {
				repositoryId,
				name: branchName,
				headSha: after,
				protected: false,
				updatedAt: now,
			});
		}

		// Extract commits from push payload
		const commits = Array.isArray(payload.commits) ? payload.commits : [];
		for (const rawCommit of commits) {
			const c = obj(rawCommit);
			const sha = str(c.id);
			if (!sha) continue;

			// Push webhook commit authors don't have full user objects with IDs
			// They have name, email, username fields instead
			// We can't reliably map to githubUserId without an API call

			const messageHeadline = str(c.message)?.split("\n")[0] ?? "";

			const existingCommit = yield* ctx.db
				.query("github_commits")
				.withIndex("by_repositoryId_and_sha", (q) =>
					q.eq("repositoryId", repositoryId).eq("sha", sha),
				)
				.first();

			if (Option.isNone(existingCommit)) {
				yield* ctx.db.insert("github_commits", {
					repositoryId,
					sha,
					authorUserId: null,
					committerUserId: null,
					messageHeadline,
					authoredAt: isoToMs(c.timestamp),
					committedAt: isoToMs(c.timestamp),
					additions: null,
					deletions: null,
					changedFiles: null,
					cachedAt: now,
				});
			}
		}

		// Also upsert the pusher as a user if available
		const pusher = extractUser(payload.sender);
		if (pusher) yield* upsertUser(pusher);
	});

/**
 * Handle `pull_request_review` events: submitted, edited, dismissed
 */
const handlePullRequestReviewEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const action = str(payload.action);
		const review = obj(payload.review);
		const pr = obj(payload.pull_request);
		const githubReviewId = num(review.id);
		const pullRequestNumber = num(pr.number);

		if (githubReviewId === null || pullRequestNumber === null) return;

		// Upsert reviewer
		const authorUser = extractUser(review.user);
		if (authorUser) yield* upsertUser(authorUser);

		const data = {
			repositoryId,
			pullRequestNumber,
			githubReviewId,
			authorUserId: authorUser?.githubUserId ?? null,
			state: str(review.state) ?? "commented",
			submittedAt: isoToMs(review.submitted_at),
			commitSha: str(review.commit_id),
		};

		const existing = yield* ctx.db
			.query("github_pull_request_reviews")
			.withIndex("by_repositoryId_and_githubReviewId", (q) =>
				q.eq("repositoryId", repositoryId).eq("githubReviewId", githubReviewId),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, {
				...data,
				...(action === "submitted" &&
				existing.value.optimisticOperationType === "submit_pr_review" &&
				existing.value.optimisticState === "pending"
					? {
							optimisticState: "confirmed",
							optimisticErrorMessage: null,
							optimisticErrorStatus: null,
							optimisticUpdatedAt: Date.now(),
						}
					: {}),
			});
			const updated = yield* ctx.db.get(existing.value._id);
			if (Option.isSome(updated)) {
				yield* syncReviewReplace(ctx.rawCtx, existing.value, updated.value);
			}
		} else {
			const pendingOptimisticReview = yield* ctx.db
				.query("github_pull_request_reviews")
				.withIndex("by_repositoryId_and_pullRequestNumber", (q) =>
					q
						.eq("repositoryId", repositoryId)
						.eq("pullRequestNumber", pullRequestNumber),
				)
				.order("desc")
				.first();

			if (
				Option.isSome(pendingOptimisticReview) &&
				action === "submitted" &&
				pendingOptimisticReview.value.optimisticOperationType ===
					"submit_pr_review" &&
				pendingOptimisticReview.value.optimisticState === "pending"
			) {
				yield* ctx.db.patch(pendingOptimisticReview.value._id, {
					...data,
					optimisticState: "confirmed",
					optimisticErrorMessage: null,
					optimisticErrorStatus: null,
					optimisticUpdatedAt: Date.now(),
				});
				const updated = yield* ctx.db.get(pendingOptimisticReview.value._id);
				if (Option.isSome(updated)) {
					yield* syncReviewReplace(
						ctx.rawCtx,
						pendingOptimisticReview.value,
						updated.value,
					);
				}
			} else {
				const id = yield* ctx.db.insert("github_pull_request_reviews", data);
				const inserted = yield* ctx.db.get(id);
				if (Option.isSome(inserted)) {
					yield* syncReviewInsert(ctx.rawCtx, inserted.value);
				}
			}
		}
	});

/**
 * Handle `pull_request_review_comment` events: created, edited, deleted
 */
const handlePullRequestReviewCommentEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		const action = str(payload.action);
		const comment = obj(payload.comment);
		const pr = obj(payload.pull_request);
		const githubReviewCommentId = num(comment.id);
		const pullRequestNumber = num(pr.number);

		if (githubReviewCommentId === null || pullRequestNumber === null) return;

		// Upsert comment author
		const authorUser = extractUser(comment.user);
		if (authorUser) yield* upsertUser(authorUser);

		if (action === "deleted") {
			const existing = yield* ctx.db
				.query("github_pull_request_review_comments")
				.withIndex("by_repositoryId_and_githubReviewCommentId", (q) =>
					q
						.eq("repositoryId", repositoryId)
						.eq("githubReviewCommentId", githubReviewCommentId),
				)
				.first();

			if (Option.isSome(existing)) {
				yield* ctx.db.delete(existing.value._id);
			}
			return;
		}

		const data = {
			repositoryId,
			pullRequestNumber,
			githubReviewCommentId,
			githubReviewId: num(comment.pull_request_review_id),
			inReplyToGithubReviewCommentId: num(comment.in_reply_to_id),
			authorUserId: authorUser?.githubUserId ?? null,
			body: str(comment.body) ?? "",
			path: str(comment.path),
			line: num(comment.line),
			originalLine: num(comment.original_line),
			startLine: num(comment.start_line),
			side: str(comment.side),
			startSide: str(comment.start_side),
			commitSha: str(comment.commit_id),
			originalCommitSha: str(comment.original_commit_id),
			htmlUrl: str(comment.html_url),
			createdAt: isoToMs(comment.created_at) ?? now,
			updatedAt: isoToMs(comment.updated_at) ?? now,
		};

		const existing = yield* ctx.db
			.query("github_pull_request_review_comments")
			.withIndex("by_repositoryId_and_githubReviewCommentId", (q) =>
				q
					.eq("repositoryId", repositoryId)
					.eq("githubReviewCommentId", githubReviewCommentId),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, data);
		} else {
			yield* ctx.db.insert("github_pull_request_review_comments", data);
		}
	});

/**
 * Handle `create` events — new branch or tag created
 */
const handleCreateEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		const refType = str(payload.ref_type);
		const ref = str(payload.ref);

		// Only handle branches (not tags)
		if (refType !== "branch" || !ref) return;

		const existing = yield* ctx.db
			.query("github_branches")
			.withIndex("by_repositoryId_and_name", (q) =>
				q.eq("repositoryId", repositoryId).eq("name", ref),
			)
			.first();

		if (Option.isNone(existing)) {
			// We don't have the SHA from a create event, use empty string as placeholder
			// The next push event will update it
			yield* ctx.db.insert("github_branches", {
				repositoryId,
				name: ref,
				headSha: str(payload.master_branch) ?? "",
				protected: false,
				updatedAt: now,
			});
		}
	});

/**
 * Handle `check_run` events: created, completed, rerequested, requested_action
 */
const handleCheckRunEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const checkRun = obj(payload.check_run);
		const githubCheckRunId = num(checkRun.id);
		const name = str(checkRun.name);
		const headSha = str(checkRun.head_sha);

		if (githubCheckRunId === null || !name || !headSha) return;

		const data = {
			repositoryId,
			githubCheckRunId,
			name,
			headSha,
			status: str(checkRun.status) ?? "queued",
			conclusion: str(checkRun.conclusion),
			startedAt: isoToMs(checkRun.started_at),
			completedAt: isoToMs(checkRun.completed_at),
		};

		const existing = yield* ctx.db
			.query("github_check_runs")
			.withIndex("by_repositoryId_and_githubCheckRunId", (q) =>
				q
					.eq("repositoryId", repositoryId)
					.eq("githubCheckRunId", githubCheckRunId),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, data);
			const updated = yield* ctx.db.get(existing.value._id);
			if (Option.isSome(updated)) {
				yield* syncCheckRunReplace(ctx.rawCtx, existing.value, updated.value);
			}
		} else {
			const id = yield* ctx.db.insert("github_check_runs", data);
			const inserted = yield* ctx.db.get(id);
			if (Option.isSome(inserted)) {
				yield* syncCheckRunInsert(ctx.rawCtx, inserted.value);
			}
		}
	});

/**
 * Handle `workflow_run` events: requested, in_progress, completed
 */
const handleWorkflowRunEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		const workflowRun = obj(payload.workflow_run);
		const githubRunId = num(workflowRun.id);
		const workflowId = num(workflowRun.workflow_id);
		const runNumber = num(workflowRun.run_number);

		if (githubRunId === null || workflowId === null || runNumber === null)
			return;

		// Upsert actor
		const actorUser = extractUser(workflowRun.actor);
		if (actorUser) yield* upsertUser(actorUser);

		const data = {
			repositoryId,
			githubRunId,
			workflowId,
			workflowName: str(workflowRun.name),
			runNumber,
			runAttempt: num(workflowRun.run_attempt) ?? 1,
			event: str(workflowRun.event) ?? "unknown",
			status: str(workflowRun.status),
			conclusion: str(workflowRun.conclusion),
			headBranch: str(workflowRun.head_branch),
			headSha: str(workflowRun.head_sha) ?? "",
			actorUserId: actorUser?.githubUserId ?? null,
			htmlUrl: str(workflowRun.html_url),
			createdAt: isoToMs(workflowRun.created_at) ?? now,
			updatedAt: isoToMs(workflowRun.updated_at) ?? now,
		};

		const existing = yield* ctx.db
			.query("github_workflow_runs")
			.withIndex("by_repositoryId_and_githubRunId", (q) =>
				q.eq("repositoryId", repositoryId).eq("githubRunId", githubRunId),
			)
			.first();

		if (Option.isSome(existing)) {
			if (data.updatedAt >= existing.value.updatedAt) {
				yield* ctx.db.patch(existing.value._id, data);
			}
		} else {
			yield* ctx.db.insert("github_workflow_runs", data);
		}
	});

/**
 * Handle `workflow_job` events: queued, in_progress, completed, waiting
 */
const handleWorkflowJobEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const workflowJob = obj(payload.workflow_job);
		const githubJobId = num(workflowJob.id);
		const githubRunId = num(workflowJob.run_id);
		const name = str(workflowJob.name);

		if (githubJobId === null || githubRunId === null || !name) return;

		// Serialize steps as JSON (steps have name, status, conclusion, etc.)
		const steps = Array.isArray(workflowJob.steps)
			? JSON.stringify(workflowJob.steps)
			: null;

		const data = {
			repositoryId,
			githubJobId,
			githubRunId,
			name,
			status: str(workflowJob.status) ?? "queued",
			conclusion: str(workflowJob.conclusion),
			startedAt: isoToMs(workflowJob.started_at),
			completedAt: isoToMs(workflowJob.completed_at),
			runnerName: str(workflowJob.runner_name),
			stepsJson: steps,
		};

		const existing = yield* ctx.db
			.query("github_workflow_jobs")
			.withIndex("by_repositoryId_and_githubJobId", (q) =>
				q.eq("repositoryId", repositoryId).eq("githubJobId", githubJobId),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, data);
			const updated = yield* ctx.db.get(existing.value._id);
			if (Option.isSome(updated)) {
				yield* syncJobReplace(ctx.rawCtx, existing.value, updated.value);
			}
		} else {
			const id = yield* ctx.db.insert("github_workflow_jobs", data);
			const inserted = yield* ctx.db.get(id);
			if (Option.isSome(inserted)) {
				yield* syncJobInsert(ctx.rawCtx, inserted.value);
			}
		}
	});

/**
 * Handle `delete` events — branch or tag deleted
 */
const handleDeleteEvent = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const refType = str(payload.ref_type);
		const ref = str(payload.ref);

		if (refType !== "branch" || !ref) return;

		const existing = yield* ctx.db
			.query("github_branches")
			.withIndex("by_repositoryId_and_name", (q) =>
				q.eq("repositoryId", repositoryId).eq("name", ref),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.delete(existing.value._id);
		}
	});

// ---------------------------------------------------------------------------
// Installation lifecycle handler
// ---------------------------------------------------------------------------

/**
 * Handle GitHub App installation and installation_repositories events.
 *
 * - `installation.created` → upsert the installation record
 * - `installation.deleted` / `installation.suspended` → update state
 * - `installation_repositories.added` / `removed` → sync repo list
 */
const handleInstallationEvent = (
	eventName: string,
	action: string | null,
	payload: Record<string, unknown>,
	installationId: number | null,
) =>
	Effect.gen(function* () {
		if (installationId === null) return;

		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		const installation = obj(payload.installation);
		const account = obj(installation.account);
		const accountLogin = str(account.login) ?? "unknown";
		const accountId = num(account.id) ?? 0;
		const accountType =
			str(account.type) === "Organization" ? "Organization" : "User";

		const upsertInstallationRepositories = (
			repositories: Array<InstallationRepository>,
		) =>
			Effect.gen(function* () {
				let newRepoCount = 0;
				const repositoriesByPriority = [...repositories].sort((a, b) => {
					const starDelta =
						(b.stargazers_count ?? 0) - (a.stargazers_count ?? 0);
					if (starDelta !== 0) return starDelta;
					return a.full_name.localeCompare(b.full_name);
				});

				for (const repo of repositoriesByPriority) {
					const githubRepoId = repo.id;
					const fullName = repo.full_name;
					const stargazersCount = repo.stargazers_count;
					const parts = fullName.split("/");
					if (parts.length !== 2) continue;

					const repoName = parts[1];
					if (repoName === undefined) continue;

					const existingRepo = yield* ctx.db
						.query("github_repositories")
						.withIndex("by_githubRepoId", (q) =>
							q.eq("githubRepoId", githubRepoId),
						)
						.first();

					const isNewRepo = Option.isNone(existingRepo);

					if (isNewRepo) {
						newRepoCount += 1;
						yield* ctx.db.insert("github_repositories", {
							githubRepoId,
							installationId,
							ownerId: accountId,
							ownerLogin: accountLogin,
							name: repoName,
							fullName,
							private: repo.private,
							visibility: repo.private ? "private" : "public",
							defaultBranch: repo.default_branch ?? "main",
							archived: false,
							disabled: false,
							fork: false,
							pushedAt: null,
							githubUpdatedAt: now,
							cachedAt: now,
							connectedByUserId: null,
							stargazersCount: stargazersCount ?? 0,
						});

						// Create sync job + start bootstrap workflow for the new repo.
						// Uses the installation token (no user session available from webhooks).
						const lockKey = `repo-bootstrap:${installationId}:${githubRepoId}`;
						const existingJob = yield* ctx.db
							.query("github_sync_jobs")
							.withIndex("by_lockKey", (q) => q.eq("lockKey", lockKey))
							.first();

						if (Option.isNone(existingJob)) {
							const prioritySortKey = -(stargazersCount ?? 0);
							yield* ctx.db.insert("github_sync_jobs", {
								jobType: "backfill",
								scopeType: "repository",
								triggerReason: "install",
								lockKey,
								installationId,
								repositoryId: githubRepoId,
								entityType: null,
								state: "pending",
								attemptCount: 0,
								nextRunAt: now,
								lastError: null,
								currentStep: null,
								completedSteps: [],
								itemsFetched: 0,
								prioritySortKey,
								createdAt: now,
								updatedAt: now,
							});

							yield* ctx.runMutation(
								internal.rpc.bootstrapWorkflow.startBootstrap,
								{
									repositoryId: githubRepoId,
									fullName,
									lockKey,
									connectedByUserId: null,
									installationId,
								},
							);
						}
					} else if (stargazersCount === undefined) {
						yield* ctx.db.patch(existingRepo.value._id, {
							installationId,
							cachedAt: now,
						});
					} else {
						yield* ctx.db.patch(existingRepo.value._id, {
							installationId,
							cachedAt: now,
							stargazersCount,
						});
					}
				}

				return newRepoCount;
			});

		if (eventName === "installation") {
			const existing = yield* ctx.db
				.query("github_installations")
				.withIndex("by_installationId", (q) =>
					q.eq("installationId", installationId),
				)
				.first();

			if (action === "created") {
				// Check for a placeholder installation (installationId: 0) for this owner
				// created by manual repo-add. If found, upgrade it to the real installation.
				const placeholder = yield* ctx.db
					.query("github_installations")
					.withIndex("by_accountLogin", (q) =>
						q.eq("accountLogin", accountLogin),
					)
					.first();

				if (
					Option.isSome(placeholder) &&
					placeholder.value.installationId === 0
				) {
					// Upgrade the placeholder to a real installation
					yield* ctx.db.patch(placeholder.value._id, {
						installationId,
						accountId,
						accountType,
						suspendedAt: null,
						permissionsDigest: JSON.stringify(obj(installation.permissions)),
						eventsDigest: JSON.stringify(installation.events ?? []),
						updatedAt: now,
					});

					// Also upgrade all repos that have installationId: 0 for this owner
					const placeholderRepos = yield* ctx.db
						.query("github_repositories")
						.withIndex("by_ownerLogin_and_name", (q) =>
							q.eq("ownerLogin", accountLogin),
						)
						.collect();

					for (const repo of placeholderRepos) {
						if (repo.installationId === 0) {
							yield* ctx.db.patch(repo._id, {
								installationId,
							});
						}
					}

					console.info(
						`[webhookProcessor] Upgraded placeholder installation for ${accountLogin} -> ${installationId}`,
					);

					// Placeholder repos were upgraded — sync permissions for the
					// installer so they appear in the sidebar immediately.
					yield* scheduleInstallationPermissionSync(payload).pipe(
						Effect.ignoreLogged,
					);
				} else if (Option.isNone(existing)) {
					yield* ctx.db.insert("github_installations", {
						installationId,
						accountId,
						accountLogin,
						accountType,
						suspendedAt: null,
						permissionsDigest: JSON.stringify(obj(installation.permissions)),
						eventsDigest: JSON.stringify(installation.events ?? []),
						updatedAt: now,
					});
				} else {
					yield* ctx.db.patch(existing.value._id, {
						accountLogin,
						accountType,
						suspendedAt: null,
						permissionsDigest: JSON.stringify(obj(installation.permissions)),
						eventsDigest: JSON.stringify(installation.events ?? []),
						updatedAt: now,
					});
				}
				console.info(
					`[webhookProcessor] Installation created: ${installationId} (${accountLogin})`,
				);

				const createdRepos = parseInstallationRepositories(
					payload.repositories,
				);
				const createdRepoCount =
					yield* upsertInstallationRepositories(createdRepos);

				if (createdRepoCount > 0) {
					yield* scheduleInstallationPermissionSync(payload).pipe(
						Effect.ignoreLogged,
					);
				}
			} else if (action === "deleted" && Option.isSome(existing)) {
				const reposForInstallation = yield* ctx.db
					.query("github_repositories")
					.withIndex("by_installationId_and_githubUpdatedAt", (q) =>
						q.eq("installationId", installationId),
					)
					.collect();

				let deletedRepoCount = 0;
				let deletedPermissionCount = 0;
				for (const repoDoc of reposForInstallation) {
					const permissions = yield* ctx.db
						.query("github_user_repo_permissions")
						.withIndex("by_repositoryId", (q) =>
							q.eq("repositoryId", repoDoc.githubRepoId),
						)
						.collect();

					for (const permission of permissions) {
						yield* ctx.db.delete(permission._id);
						deletedPermissionCount += 1;
					}

					yield* ctx.db.delete(repoDoc._id);
					deletedRepoCount += 1;
				}

				const scopeTypes: ReadonlyArray<
					"installation" | "repository" | "entity"
				> = ["installation", "repository", "entity"];
				let deletedSyncJobCount = 0;
				for (const scopeType of scopeTypes) {
					const jobs = yield* ctx.db
						.query("github_sync_jobs")
						.withIndex("by_scopeType_and_installationId", (q) =>
							q.eq("scopeType", scopeType).eq("installationId", installationId),
						)
						.collect();

					for (const job of jobs) {
						yield* ctx.db.delete(job._id);
						deletedSyncJobCount += 1;
					}
				}

				yield* ctx.db.delete(existing.value._id);
				console.info(
					`[webhookProcessor] Installation deleted: ${installationId} (${accountLogin}) repos=${deletedRepoCount} permissions=${deletedPermissionCount} jobs=${deletedSyncJobCount}`,
				);
			} else if (action === "suspend" && Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, {
					suspendedAt: now,
					updatedAt: now,
				});
			} else if (action === "unsuspend" && Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, {
					suspendedAt: null,
					updatedAt: now,
				});
			}
		}

		if (eventName === "installation_repositories") {
			// Repos added to the installation
			const added = parseInstallationRepositories(payload.repositories_added);
			const newRepoCount = yield* upsertInstallationRepositories(added);

			// When new repos are added, sync permissions for the user who
			// triggered the installation so their sidebar updates immediately.
			if (newRepoCount > 0) {
				yield* scheduleInstallationPermissionSync(payload).pipe(
					Effect.ignoreLogged,
				);
			}

			// Repos removed from the installation
			const removed = parseInstallationRepositories(
				payload.repositories_removed,
			);
			for (const repo of removed) {
				const githubRepoId = num(repo.id);
				if (githubRepoId === null) continue;

				const permissions = yield* ctx.db
					.query("github_user_repo_permissions")
					.withIndex("by_repositoryId", (q) =>
						q.eq("repositoryId", githubRepoId),
					)
					.collect();
				for (const permission of permissions) {
					yield* ctx.db.delete(permission._id);
				}

				const existingRepo = yield* ctx.db
					.query("github_repositories")
					.withIndex("by_githubRepoId", (q) =>
						q.eq("githubRepoId", githubRepoId),
					)
					.first();

				if (Option.isSome(existingRepo)) {
					yield* ctx.db.delete(existingRepo.value._id);
				}
			}

			console.info(
				`[webhookProcessor] installation_repositories: +${added.length} -${removed.length} for installation ${installationId}`,
			);
		}
	});

/**
 * After repos are added via an installation webhook, sync permissions for the
 * user who triggered the installation (the `sender` in the webhook payload).
 *
 * This closes the race condition where a user signs in *before* installing the
 * GitHub App: their initial permission sync finds no repos, and without this
 * trigger there is nothing to re-sync once the repos are created.
 */
const scheduleInstallationPermissionSync = (payload: Record<string, unknown>) =>
	Effect.gen(function* () {
		const sender = extractUser(payload.sender);
		if (sender === null) return;

		const ctx = yield* ConfectMutationCtx;
		const account = yield* ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: "account",
			where: [
				{ field: "providerId", value: "github" },
				{ field: "accountId", value: String(sender.githubUserId) },
			],
		});

		if (
			account !== null &&
			typeof account === "object" &&
			"userId" in account &&
			typeof account.userId === "string"
		) {
			yield* Effect.promise(() =>
				ctx.scheduler.runAfter(
					0,
					internal.rpc.githubActions.syncUserPermissions,
					{
						userId: account.userId,
					},
				),
			);
			console.info(
				`[webhookProcessor] Scheduled permission sync for user ${account.userId} after installation change`,
			);
		}
	});

// ---------------------------------------------------------------------------
// Shared dispatcher — used by both single-event and batch processors
// ---------------------------------------------------------------------------

const dispatchHandler = (
	eventName: string,
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Match.value(eventName).pipe(
		Match.when("issues", () => handleIssuesEvent(payload, repositoryId)),
		Match.when("pull_request", () =>
			handlePullRequestEvent(payload, repositoryId),
		),
		Match.when("issue_comment", () =>
			handleIssueCommentEvent(payload, repositoryId),
		),
		Match.when("push", () => handlePushEvent(payload, repositoryId)),
		Match.when("pull_request_review", () =>
			handlePullRequestReviewEvent(payload, repositoryId),
		),
		Match.when("pull_request_review_comment", () =>
			handlePullRequestReviewCommentEvent(payload, repositoryId),
		),
		Match.when("check_run", () => handleCheckRunEvent(payload, repositoryId)),
		Match.when("workflow_run", () =>
			handleWorkflowRunEvent(payload, repositoryId),
		),
		Match.when("workflow_job", () =>
			handleWorkflowJobEvent(payload, repositoryId),
		),
		Match.when("create", () => handleCreateEvent(payload, repositoryId)),
		Match.when("delete", () => handleDeleteEvent(payload, repositoryId)),
		Match.orElse(() => Effect.void),
	);

// ---------------------------------------------------------------------------
// Activity feed extraction — build activity entry from webhook payload
// ---------------------------------------------------------------------------

type ActivityInfo = {
	activityType: string;
	title: string;
	description: string | null;
	actorLogin: string | null;
	actorAvatarUrl: string | null;
	entityNumber: number | null;
};

/**
 * Extract activity feed information from a webhook event.
 * Returns null for events that shouldn't appear in the feed (e.g. unknown events).
 */
const extractActivityInfo = (
	eventName: string,
	action: string | null,
	payload: Record<string, unknown>,
): ActivityInfo | null => {
	const sender = extractUser(payload.sender);
	const actorLogin = sender?.login ?? null;
	const actorAvatarUrl = sender?.avatarUrl ?? null;

	return Match.value(eventName).pipe(
		Match.when("issues", () => {
			const issue = obj(payload.issue);
			const number = num(issue.number);
			const title = str(issue.title) ?? "";
			return {
				activityType: `issue.${action ?? "updated"}`,
				title,
				description:
					action === "opened" ? (str(issue.body)?.slice(0, 200) ?? null) : null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: number,
			};
		}),
		Match.when("pull_request", () => {
			const pr = obj(payload.pull_request);
			const number = num(pr.number);
			const title = str(pr.title) ?? "";
			return {
				activityType: `pr.${action ?? "updated"}`,
				title,
				description:
					action === "opened" ? (str(pr.body)?.slice(0, 200) ?? null) : null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: number,
			};
		}),
		Match.when("issue_comment", () => {
			const issue = obj(payload.issue);
			const comment = obj(payload.comment);
			const number = num(issue.number);
			const isPr = "pull_request" in issue;
			return {
				activityType: isPr
					? `pr_comment.${action ?? "created"}`
					: `issue_comment.${action ?? "created"}`,
				title: str(issue.title) ?? "",
				description: str(comment.body)?.slice(0, 200) ?? null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: number,
			};
		}),
		Match.when("push", () => {
			const ref = str(payload.ref);
			const branchName = ref?.startsWith("refs/heads/")
				? ref.slice("refs/heads/".length)
				: ref;
			const commits = Array.isArray(payload.commits) ? payload.commits : [];
			const commitCount = commits.length;
			return {
				activityType: "push",
				title: `Pushed ${commitCount} commit${commitCount !== 1 ? "s" : ""} to ${branchName ?? "unknown"}`,
				description:
					commitCount > 0
						? (str(obj(commits[0]).message)?.split("\n")[0] ?? null)
						: null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: null,
			};
		}),
		Match.when("pull_request_review", () => {
			const pr = obj(payload.pull_request);
			const review = obj(payload.review);
			const number = num(pr.number);
			const state = str(review.state) ?? "commented";
			return {
				activityType: `pr_review.${state}`,
				title: str(pr.title) ?? "",
				description: null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: number,
			};
		}),
		Match.when("pull_request_review_comment", () => {
			const pr = obj(payload.pull_request);
			const comment = obj(payload.comment);
			const number = num(pr.number);
			return {
				activityType: `pr_review_comment.${action ?? "created"}`,
				title: str(pr.title) ?? "",
				description: str(comment.body)?.slice(0, 200) ?? null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: number,
			};
		}),
		Match.when("check_run", () => {
			const checkRun = obj(payload.check_run);
			const name = str(checkRun.name) ?? "Check";
			const conclusion = str(checkRun.conclusion);
			// Only emit activity for completed check runs
			if (action !== "completed") return null;
			return {
				activityType: `check_run.${conclusion ?? "completed"}`,
				title: name,
				description: conclusion ? `Conclusion: ${conclusion}` : null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: null,
			};
		}),
		Match.when("workflow_run", () => {
			const workflowRun = obj(payload.workflow_run);
			const name = str(workflowRun.name) ?? "Workflow";
			const conclusion = str(workflowRun.conclusion);
			const runNumber = num(workflowRun.run_number);
			// Only emit activity for completed workflow runs
			if (action !== "completed") return null;
			return {
				activityType: `workflow_run.${conclusion ?? "completed"}`,
				title: `${name} #${runNumber ?? "?"}`,
				description: conclusion ? `Conclusion: ${conclusion}` : null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: null,
			};
		}),
		Match.when("create", () => {
			const refType = str(payload.ref_type);
			const ref = str(payload.ref);
			if (refType !== "branch") return null;
			return {
				activityType: "branch.created",
				title: `Created branch ${ref ?? "unknown"}`,
				description: null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: null,
			};
		}),
		Match.when("delete", () => {
			const refType = str(payload.ref_type);
			const ref = str(payload.ref);
			if (refType !== "branch") return null;
			return {
				activityType: "branch.deleted",
				title: `Deleted branch ${ref ?? "unknown"}`,
				description: null,
				actorLogin,
				actorAvatarUrl,
				entityNumber: null,
			};
		}),
		Match.orElse(() => null),
	);
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum events to process per batch invocation (stay within mutation budget).
 *  Each event requires JSON parsing plus multiple index lookups and aggregate
 *  B-tree syncs (~40-55 document reads per event). The cron fires every 2s. */
const BATCH_SIZE = 5;

/** Maximum processing attempts before dead-lettering */
const MAX_ATTEMPTS = 5;

/** Base backoff delay in ms — actual delay = BACKOFF_BASE_MS * 2^(attempt-1) */
const BACKOFF_BASE_MS = 1_000;

// ---------------------------------------------------------------------------
// Retry / backoff helpers
// ---------------------------------------------------------------------------

/**
 * Compute next retry timestamp using exponential backoff with jitter.
 * attempt is 1-based (the attempt that just failed).
 */
const computeNextRetryAt = (attempt: number): number => {
	const exponential = BACKOFF_BASE_MS * 2 ** (attempt - 1);
	// Add up to 25 % jitter so retries don't thundering-herd
	const jitter = Math.floor(Math.random() * exponential * 0.25);
	return Date.now() + exponential + jitter;
};

// ---------------------------------------------------------------------------
// Shared post-success logic: activity feed + projections
// ---------------------------------------------------------------------------

/** PR actions that should trigger a file diff sync */
const PR_SYNC_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

const afterSuccessfulProcessing = (
	event: {
		eventName: string;
		action: string | null;
		installationId: number | null;
	},
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const activityInfo = extractActivityInfo(
			event.eventName,
			event.action,
			payload,
		);
		if (activityInfo !== null) {
			yield* appendActivityFeedEntry(
				repositoryId,
				event.installationId ?? 0,
				activityInfo.activityType,
				activityInfo.title,
				activityInfo.description,
				activityInfo.actorLogin,
				activityInfo.actorAvatarUrl,
				activityInfo.entityNumber,
			).pipe(Effect.ignoreLogged);
		}

		// Schedule PR file diff sync for relevant PR events
		if (
			event.eventName === "pull_request" &&
			event.action !== null &&
			PR_SYNC_ACTIONS.has(event.action)
		) {
			yield* schedulePrFileSync(payload, repositoryId).pipe(
				Effect.ignoreLogged,
			);
		}

		yield* scheduleMemberPermissionSync(event.eventName, payload).pipe(
			Effect.ignoreLogged,
		);
	});

/**
 * Schedule a syncPrFiles action for a pull request event.
 * Extracts owner/name/number/headSha from the payload and uses
 * ctx.scheduler.runAfter to trigger the action asynchronously.
 */
const schedulePrFileSync = (
	payload: Record<string, unknown>,
	repositoryId: number,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const pr = obj(payload.pull_request);
		const repo = obj(payload.repository);
		const prNumber = num(pr.number);
		const headObj = obj(pr.head);
		const headSha = str(headObj.sha);
		const fullName = str(repo.full_name);

		if (prNumber === null || !headSha || !fullName) return;

		const parts = fullName.split("/");
		if (parts.length !== 2) return;
		const ownerLogin = parts[0];
		const name = parts[1];

		// Look up the repo installation for token resolution
		const repoDoc = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) => q.eq("githubRepoId", repositoryId))
			.first();
		const installationId = Option.isSome(repoDoc)
			? repoDoc.value.installationId
			: 0;
		if (installationId <= 0) return;

		yield* Effect.promise(() =>
			ctx.scheduler.runAfter(0, internal.rpc.githubActions.syncPrFiles, {
				ownerLogin,
				name,
				repositoryId,
				pullRequestNumber: prNumber,
				headSha,
				installationId,
			}),
		);
	});

/**
 * For `member` webhook events, sync permissions for the affected user
 * if they have linked a GitHub account in Better Auth.
 */
const scheduleMemberPermissionSync = (
	eventName: string,
	payload: Record<string, unknown>,
) =>
	Effect.gen(function* () {
		if (eventName !== "member") return;

		const ctx = yield* ConfectMutationCtx;
		const member = obj(payload.member);
		const memberId = num(member.id);
		if (memberId === null) return;

		const account = yield* ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: "account",
			where: [
				{ field: "providerId", value: "github" },
				{ field: "accountId", value: String(memberId) },
			],
		});

		if (
			account !== null &&
			typeof account === "object" &&
			"userId" in account &&
			typeof account.userId === "string"
		) {
			yield* Effect.promise(() =>
				ctx.scheduler.runAfter(
					0,
					internal.rpc.githubActions.syncUserPermissions,
					{
						userId: account.userId,
					},
				),
			);
		}
	});

// ---------------------------------------------------------------------------
// Processor — dispatches raw webhook events to appropriate handlers
// ---------------------------------------------------------------------------

/**
 * Process a single raw webhook event.
 * Reads the event from github_webhook_events_raw by deliveryId,
 * dispatches to the appropriate handler, and marks the event as processed.
 * On failure, applies retry with exponential backoff, or dead-letters after MAX_ATTEMPTS.
 */
const processWebhookEventDef = factory.internalMutation({
	payload: {
		deliveryId: Schema.String,
	},
	success: Schema.Struct({
		processed: Schema.Boolean,
		eventName: Schema.String,
		action: Schema.NullOr(Schema.String),
	}),
});

/**
 * Process a batch of pending webhook events.
 * Iterates through events with processState="pending" (oldest first, up to BATCH_SIZE).
 *
 * For each event:
 * - Success → mark "processed", update activity feed + projections
 * - Failure with attempts < MAX_ATTEMPTS → mark "retry" with exponential backoff
 * - Failure with attempts >= MAX_ATTEMPTS → move to dead letters
 */
const processAllPendingDef = factory.internalMutation({
	success: Schema.Struct({
		processed: Schema.Number,
		retried: Schema.Number,
		deadLettered: Schema.Number,
	}),
});

/**
 * Promote retry events whose backoff window has elapsed back to "pending".
 * Called by the cron on a regular cadence so they get re-processed.
 */
const promoteRetryEventsDef = factory.internalMutation({
	success: Schema.Struct({
		promoted: Schema.Number,
	}),
});

/**
 * Get queue health metrics for operational visibility.
 */
const getQueueHealthDef = factory.internalQuery({
	success: Schema.Struct({
		pending: Schema.Number,
		retry: Schema.Number,
		failed: Schema.Number,
		deadLetters: Schema.Number,
		recentProcessed: Schema.Number,
	}),
});

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

processWebhookEventDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		const rawEvent = yield* ctx.db
			.query("github_webhook_events_raw")
			.withIndex("by_deliveryId", (q) => q.eq("deliveryId", args.deliveryId))
			.first();

		if (Option.isNone(rawEvent)) {
			return { processed: false, eventName: "unknown", action: null };
		}

		const event = rawEvent.value;

		// Skip already-processed
		if (event.processState === "processed") {
			return {
				processed: true,
				eventName: event.eventName,
				action: event.action,
			};
		}

		const payload: Record<string, unknown> = JSON.parse(event.payloadJson);
		const repositoryId = event.repositoryId;

		// Events without a repository — handle installation lifecycle, skip others
		if (repositoryId === null) {
			if (
				event.eventName === "installation" ||
				event.eventName === "installation_repositories"
			) {
				yield* handleInstallationEvent(
					event.eventName,
					event.action,
					payload,
					event.installationId,
				);
			}
			yield* ctx.db.patch(event._id, { processState: "processed" });
			const updatedEvent = yield* ctx.db.get(event._id);
			if (Option.isSome(updatedEvent)) {
				yield* syncWebhookReplace(ctx.rawCtx, event, updatedEvent.value);
			}
			return {
				processed: true,
				eventName: event.eventName,
				action: event.action,
			};
		}

		const nextAttempt = event.processAttempts + 1;

		const succeeded = yield* dispatchHandler(
			event.eventName,
			payload,
			repositoryId,
		).pipe(
			Effect.map(() => true),
			Effect.catchAll((error) =>
				Effect.gen(function* () {
					if (nextAttempt >= MAX_ATTEMPTS) {
						// Dead-letter: move to dead_letters table
						yield* ctx.db.insert("github_dead_letters", {
							deliveryId: event.deliveryId,
							reason: `Exhausted ${MAX_ATTEMPTS} attempts. Last error: ${String(error)}`,
							payloadJson: event.payloadJson,
							createdAt: Date.now(),
							source: "webhook",
						});
						// Sync aggregate before deleting from table
						yield* syncWebhookDelete(ctx.rawCtx, event);
						yield* ctx.db.delete(event._id);
					} else {
						// Retry: exponential backoff
						yield* ctx.db.patch(event._id, {
							processState: "retry",
							processError: String(error),
							processAttempts: nextAttempt,
							nextRetryAt: computeNextRetryAt(nextAttempt),
						});
						const updatedEvent = yield* ctx.db.get(event._id);
						if (Option.isSome(updatedEvent)) {
							yield* syncWebhookReplace(ctx.rawCtx, event, updatedEvent.value);
						}
					}
					return false;
				}),
			),
		);

		if (succeeded) {
			yield* ctx.db.patch(event._id, {
				processState: "processed",
				processAttempts: nextAttempt,
			});
			const updatedEvent = yield* ctx.db.get(event._id);
			if (Option.isSome(updatedEvent)) {
				yield* syncWebhookReplace(ctx.rawCtx, event, updatedEvent.value);
			}
			yield* afterSuccessfulProcessing(event, payload, repositoryId);
		}

		return {
			processed: succeeded,
			eventName: event.eventName,
			action: event.action,
		};
	}),
);

processAllPendingDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let processed = 0;
		let retried = 0;
		let deadLettered = 0;

		const pendingEvents = yield* ctx.db
			.query("github_webhook_events_raw")
			.withIndex("by_processState_and_receivedAt", (q) =>
				q.eq("processState", "pending"),
			)
			.take(BATCH_SIZE);

		for (const event of pendingEvents) {
			const payload: Record<string, unknown> = JSON.parse(event.payloadJson);
			const repositoryId = event.repositoryId;

			// Events without a repo — handle installation lifecycle, skip others
			if (repositoryId === null) {
				if (
					event.eventName === "installation" ||
					event.eventName === "installation_repositories"
				) {
					yield* handleInstallationEvent(
						event.eventName,
						event.action,
						payload,
						event.installationId,
					);
				}
				yield* ctx.db.patch(event._id, { processState: "processed" });
				const updatedEvent = yield* ctx.db.get(event._id);
				if (Option.isSome(updatedEvent)) {
					yield* syncWebhookReplace(ctx.rawCtx, event, updatedEvent.value);
				}
				processed++;

				// Installation events are heavy (repo inserts + bootstrap scheduling).
				// Process at most one per batch run to stay within the mutation CPU budget.
				if (
					event.eventName === "installation" ||
					event.eventName === "installation_repositories"
				) {
					return { processed, retried, deadLettered };
				}
				continue;
			}

			const nextAttempt = event.processAttempts + 1;

			const succeeded = yield* dispatchHandler(
				event.eventName,
				payload,
				repositoryId,
			).pipe(
				Effect.map(() => true),
				Effect.catchAll((error) =>
					Effect.gen(function* () {
						if (nextAttempt >= MAX_ATTEMPTS) {
							// Dead-letter
							yield* ctx.db.insert("github_dead_letters", {
								deliveryId: event.deliveryId,
								reason: `Exhausted ${MAX_ATTEMPTS} attempts. Last error: ${String(error)}`,
								payloadJson: event.payloadJson,
								createdAt: Date.now(),
								source: "webhook",
							});
							yield* syncWebhookDelete(ctx.rawCtx, event);
							yield* ctx.db.delete(event._id);
							deadLettered++;
						} else {
							// Retry with backoff
							yield* ctx.db.patch(event._id, {
								processState: "retry",
								processError: String(error),
								processAttempts: nextAttempt,
								nextRetryAt: computeNextRetryAt(nextAttempt),
							});
							const updatedEvent = yield* ctx.db.get(event._id);
							if (Option.isSome(updatedEvent)) {
								yield* syncWebhookReplace(
									ctx.rawCtx,
									event,
									updatedEvent.value,
								);
							}
							retried++;
						}
						return false;
					}),
				),
			);

			if (succeeded) {
				yield* ctx.db.patch(event._id, {
					processState: "processed",
					processAttempts: nextAttempt,
				});
				const updatedEvent = yield* ctx.db.get(event._id);
				if (Option.isSome(updatedEvent)) {
					yield* syncWebhookReplace(ctx.rawCtx, event, updatedEvent.value);
				}
				yield* afterSuccessfulProcessing(event, payload, repositoryId);
				processed++;
			}
		}

		// Structured log for operational visibility
		if (processed > 0 || retried > 0 || deadLettered > 0) {
			console.info(
				`[webhookProcessor] processAllPending: processed=${processed} retried=${retried} deadLettered=${deadLettered} batchSize=${pendingEvents.length}`,
			);
		}

		return { processed, retried, deadLettered };
	}),
);

promoteRetryEventsDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		let promoted = 0;

		// Find retry events whose backoff window has elapsed
		const retryEvents = yield* ctx.db
			.query("github_webhook_events_raw")
			.withIndex("by_processState_and_nextRetryAt", (q) =>
				q.eq("processState", "retry").lte("nextRetryAt", now),
			)
			.take(BATCH_SIZE);

		for (const event of retryEvents) {
			yield* ctx.db.patch(event._id, {
				processState: "pending",
				nextRetryAt: null,
			});
			const updatedEvent = yield* ctx.db.get(event._id);
			if (Option.isSome(updatedEvent)) {
				yield* syncWebhookReplace(ctx.rawCtx, event, updatedEvent.value);
			}
			promoted++;
		}

		if (promoted > 0) {
			console.info(
				`[webhookProcessor] promoteRetryEvents: promoted=${promoted}`,
			);
		}

		return { promoted };
	}),
);

getQueueHealthDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const raw = ctx.rawCtx;

		const countByState = (state: "pending" | "retry" | "failed") =>
			Effect.tryPromise({
				try: () => webhooksByState.count(raw, { namespace: state }),
				catch: (error) => new Error(String(error)),
			}).pipe(
				Effect.catchAll((error) => {
					if (
						error.message.includes('Component "') &&
						error.message.includes("is not registered")
					) {
						return ctx.db
							.query("github_webhook_events_raw")
							.withIndex("by_processState_and_receivedAt", (q) =>
								q.eq("processState", state),
							)
							.take(10001)
							.pipe(Effect.map((items) => Math.min(items.length, 10000)));
					}
					return Effect.die(error);
				}),
			);

		// O(log n) counts via webhooksByState aggregate
		const [pending, retry, failed] = yield* Effect.all([
			countByState("pending"),
			countByState("retry"),
			countByState("failed"),
		]);

		const deadLetters = yield* ctx.db
			.query("github_dead_letters")
			.take(10001)
			.pipe(Effect.map((items) => Math.min(items.length, 10000)));

		// Recent processed in last hour — still needs index range query
		const oneHourAgo = Date.now() - 3_600_000;
		const recentProcessed = yield* ctx.db
			.query("github_webhook_events_raw")
			.withIndex("by_processState_and_receivedAt", (q) =>
				q.eq("processState", "processed").gte("receivedAt", oneHourAgo),
			)
			.take(10001)
			.pipe(Effect.map((items) => Math.min(items.length, 10000)));

		return {
			pending,
			retry,
			failed,
			deadLetters,
			recentProcessed,
		};
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const webhookProcessorModule = makeRpcModule(
	{
		processWebhookEvent: processWebhookEventDef,
		processAllPending: processAllPendingDef,
		promoteRetryEvents: promoteRetryEventsDef,
		getQueueHealth: getQueueHealthDef,
	},
	{ middlewares: DatabaseRpcModuleMiddlewares },
);

export const {
	processWebhookEvent,
	processAllPending,
	promoteRetryEvents,
	getQueueHealth,
} = webhookProcessorModule.handlers;
export { webhookProcessorModule };
export type WebhookProcessorModule = typeof webhookProcessorModule;
