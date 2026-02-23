/**
 * GitHub write workflows with optimistic updates.
 *
 * Pattern:
 *   1. Public MUTATION writes optimistic state directly into the canonical
 *      domain row (`github_issues`, `github_pull_requests`,
 *      `github_issue_comments`, `github_pull_request_reviews`)
 *      and schedules an internal action.
 *   2. Internal ACTION calls GitHub API and marks the optimistic row as
 *      `pending` (accepted) or `failed` (error details).
 *   3. When the webhook arrives, webhookProcessor reconciles the row to
 *      `confirmed` — proving the write landed.
 *
 * The UI subscribes to domain projections and can show optimistic state
 * immediately, then converge to confirmed state.
 */
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { internal } from "../_generated/api";
import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	confectSchema,
} from "../confect";
import { toNumberOrNull as num } from "../shared/coerce";
import { GitHubApiClient, type GitHubClient } from "../shared/githubApi";
import { lookupGitHubTokenByUserIdConfect } from "../shared/githubToken";
import { DatabaseRpcModuleMiddlewares } from "./moduleMiddlewares";
import {
	ReadGitHubRepoByIdMiddleware,
	ReadGitHubRepoPermission,
} from "./security";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

const OperationType = Schema.Literal(
	"create_issue",
	"create_comment",
	"update_issue_state",
	"merge_pull_request",
	"update_pull_request_branch",
	"submit_pr_review",
	"update_labels",
	"update_assignees",
);

const OperationState = Schema.Literal(
	"pending",
	"completed",
	"failed",
	"confirmed",
);

const WriteOperation = Schema.Struct({
	_id: Schema.String,
	_creationTime: Schema.Number,
	correlationId: Schema.String,
	operationType: OperationType,
	state: OperationState,
	repositoryId: Schema.Number,
	ownerLogin: Schema.String,
	repoName: Schema.String,
	inputPayloadJson: Schema.String,
	optimisticDataJson: Schema.NullOr(Schema.String),
	resultDataJson: Schema.NullOr(Schema.String),
	errorMessage: Schema.NullOr(Schema.String),
	errorStatus: Schema.NullOr(Schema.Number),
	githubEntityNumber: Schema.NullOr(Schema.Number),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
});

class GitHubWriteError extends Schema.TaggedError<GitHubWriteError>()(
	"GitHubWriteError",
	{
		status: Schema.Number,
		message: Schema.String,
	},
) {}

class DuplicateOperationError extends Schema.TaggedError<DuplicateOperationError>()(
	"DuplicateOperationError",
	{
		correlationId: Schema.String,
	},
) {}

class NotAuthenticated extends Schema.TaggedError<NotAuthenticated>()(
	"NotAuthenticated",
	{
		reason: Schema.String,
	},
) {}

const RequiredPermission = Schema.Literal(
	"pull",
	"triage",
	"push",
	"maintain",
	"admin",
);

class InsufficientPermission extends Schema.TaggedError<InsufficientPermission>()(
	"InsufficientPermission",
	{
		repositoryId: Schema.Number,
		required: RequiredPermission,
	},
) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toSyntheticIssueNumber = (correlationId: string): number => {
	let hash = 0;
	for (const char of correlationId) {
		hash = (hash * 31 + char.charCodeAt(0)) | 0;
	}
	if (hash === 0) return -Date.now();
	if (hash > 0) return -hash;
	return hash;
};

/**
 * Resolve the signed-in user's better-auth ID from the mutation context.
 * Every write operation must run as the signed-in user, not the repo connector.
 */
const getActingUserId = (ctx: {
	auth: {
		getUserIdentity: () => Effect.Effect<Option.Option<{ subject: string }>>;
	};
}): Effect.Effect<string, NotAuthenticated> =>
	Effect.gen(function* () {
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) {
			return yield* new NotAuthenticated({ reason: "User is not signed in" });
		}
		return identity.value.subject;
	});

const resolveWriteTokenAndClient = (
	ctx: ConfectActionCtx,
	actingUserId: string,
) =>
	Effect.gen(function* () {
		const token = yield* lookupGitHubTokenByUserIdConfect(
			(query, params) => ctx.runQuery(query, params),
			(mutation, params) => ctx.runMutation(mutation, params),
			actingUserId,
		).pipe(
			Effect.catchAll(
				(error) =>
					new NotAuthenticated({
						reason: error.reason,
					}),
			),
		);

		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		return { token, gh };
	});

const ensureWriteSucceeded = (result: {
	success: boolean;
	errorStatus: number | null;
	errorMessage: string | null;
}) =>
	result.success
		? Effect.void
		: new GitHubWriteError({
				status: result.errorStatus ?? 0,
				message: result.errorMessage ?? "GitHub write failed",
			});

const executeWithAuthRefreshRetry = <
	A extends {
		success: boolean;
		errorStatus: number | null;
		errorMessage: string | null;
	},
>(
	ctx: ConfectActionCtx,
	actingUserId: string,
	execute: (auth: {
		token: string;
		gh: { client: GitHubClient };
	}) => Effect.Effect<A>,
): Effect.Effect<A, NotAuthenticated> =>
	Effect.gen(function* () {
		const initialAuth = yield* resolveWriteTokenAndClient(ctx, actingUserId);
		const initialResult = yield* execute(initialAuth);

		if (initialResult.errorStatus !== 401) {
			return initialResult;
		}

		const refreshedToken = yield* lookupGitHubTokenByUserIdConfect(
			(query, params) => ctx.runQuery(query, params),
			(mutation, params) => ctx.runMutation(mutation, params),
			actingUserId,
			{ forceRefresh: true },
		).pipe(
			Effect.catchAll(
				(error) =>
					new NotAuthenticated({
						reason: error.reason,
					}),
			),
		);

		const refreshedGh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(refreshedToken),
		);

		return yield* execute({ token: refreshedToken, gh: refreshedGh });
	});

// ---------------------------------------------------------------------------
// 1. Public actions — execute writes immediately against GitHub
// ---------------------------------------------------------------------------

const createIssueDef = factory.action({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		title: Schema.String,
		body: Schema.optional(Schema.String),
		labels: Schema.optional(Schema.Array(Schema.String)),
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: Schema.Union(
		DuplicateOperationError,
		NotAuthenticated,
		InsufficientPermission,
		GitHubWriteError,
	),
});

createIssueDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const actingUserId = yield* getActingUserId(ctx);

		const result = yield* executeWithAuthRefreshRetry(
			ctx,
			actingUserId,
			({ gh }) =>
				executeCreateIssue(gh, args.ownerLogin, args.name, {
					title: args.title,
					body: args.body ?? undefined,
					labels: args.labels ?? [],
				}),
		);
		yield* ensureWriteSucceeded(result);

		return { correlationId: args.correlationId };
	}),
);

const createCommentDef = factory.action({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		number: Schema.Number,
		body: Schema.String,
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: Schema.Union(
		DuplicateOperationError,
		NotAuthenticated,
		InsufficientPermission,
		GitHubWriteError,
	),
});

createCommentDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const actingUserId = yield* getActingUserId(ctx);

		const result = yield* executeWithAuthRefreshRetry(
			ctx,
			actingUserId,
			({ gh }) =>
				executeCreateComment(gh, args.ownerLogin, args.name, {
					number: args.number,
					body: args.body,
				}),
		);
		yield* ensureWriteSucceeded(result);

		return { correlationId: args.correlationId };
	}),
);

const updateIssueStateDef = factory.action({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		number: Schema.Number,
		state: Schema.Literal("open", "closed"),
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: Schema.Union(
		DuplicateOperationError,
		NotAuthenticated,
		InsufficientPermission,
		GitHubWriteError,
	),
});

updateIssueStateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const actingUserId = yield* getActingUserId(ctx);

		const result = yield* executeWithAuthRefreshRetry(
			ctx,
			actingUserId,
			({ gh }) =>
				executeUpdateIssueState(gh, args.ownerLogin, args.name, {
					number: args.number,
					state: args.state,
				}),
		);
		yield* ensureWriteSucceeded(result);

		return { correlationId: args.correlationId };
	}),
);

const mergePullRequestDef = factory.action({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		number: Schema.Number,
		mergeMethod: Schema.optional(Schema.Literal("merge", "squash", "rebase")),
		commitTitle: Schema.optional(Schema.String),
		commitMessage: Schema.optional(Schema.String),
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: Schema.Union(
		DuplicateOperationError,
		NotAuthenticated,
		InsufficientPermission,
		GitHubWriteError,
	),
});

mergePullRequestDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const actingUserId = yield* getActingUserId(ctx);

		const result = yield* executeWithAuthRefreshRetry(
			ctx,
			actingUserId,
			({ gh }) =>
				executeMergePullRequest(gh, args.ownerLogin, args.name, {
					number: args.number,
					mergeMethod: args.mergeMethod ?? undefined,
					commitTitle: args.commitTitle ?? undefined,
					commitMessage: args.commitMessage ?? undefined,
				}),
		);
		yield* ensureWriteSucceeded(result);

		return { correlationId: args.correlationId };
	}),
);

const updatePullRequestBranchDef = factory.action({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		number: Schema.Number,
		expectedHeadSha: Schema.optional(Schema.String),
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: Schema.Union(
		DuplicateOperationError,
		NotAuthenticated,
		InsufficientPermission,
		GitHubWriteError,
	),
});

updatePullRequestBranchDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const actingUserId = yield* getActingUserId(ctx);

		const result = yield* executeWithAuthRefreshRetry(
			ctx,
			actingUserId,
			({ token }) =>
				executeUpdatePullRequestBranch(
					args.ownerLogin,
					args.name,
					{
						number: args.number,
						expectedHeadSha: args.expectedHeadSha ?? undefined,
					},
					token,
				),
		);
		yield* ensureWriteSucceeded(result);

		return { correlationId: args.correlationId };
	}),
);

const submitPrReviewDef = factory.action({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		number: Schema.Number,
		event: Schema.Literal("APPROVE", "REQUEST_CHANGES", "COMMENT"),
		body: Schema.optional(Schema.String),
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: Schema.Union(
		DuplicateOperationError,
		NotAuthenticated,
		InsufficientPermission,
		GitHubWriteError,
	),
});

submitPrReviewDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const actingUserId = yield* getActingUserId(ctx);

		const result = yield* executeWithAuthRefreshRetry(
			ctx,
			actingUserId,
			({ gh }) =>
				executeSubmitPrReview(gh, args.ownerLogin, args.name, {
					number: args.number,
					event: args.event,
					body: args.body ?? undefined,
				}),
		);
		yield* ensureWriteSucceeded(result);

		return { correlationId: args.correlationId };
	}),
);

const updateLabelsDef = factory.action({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		number: Schema.Number,
		labelsToAdd: Schema.Array(Schema.String),
		labelsToRemove: Schema.Array(Schema.String),
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: Schema.Union(
		DuplicateOperationError,
		NotAuthenticated,
		InsufficientPermission,
		GitHubWriteError,
	),
});

updateLabelsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const actingUserId = yield* getActingUserId(ctx);

		const result = yield* executeWithAuthRefreshRetry(
			ctx,
			actingUserId,
			({ gh }) =>
				executeUpdateLabels(gh, args.ownerLogin, args.name, {
					number: args.number,
					labelsToAdd: args.labelsToAdd,
					labelsToRemove: args.labelsToRemove,
				}),
		);
		yield* ensureWriteSucceeded(result);

		return { correlationId: args.correlationId };
	}),
);

const updateAssigneesDef = factory.action({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		number: Schema.Number,
		assigneesToAdd: Schema.Array(Schema.String),
		assigneesToRemove: Schema.Array(Schema.String),
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: Schema.Union(
		DuplicateOperationError,
		NotAuthenticated,
		InsufficientPermission,
		GitHubWriteError,
	),
});

updateAssigneesDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const actingUserId = yield* getActingUserId(ctx);

		const result = yield* executeWithAuthRefreshRetry(
			ctx,
			actingUserId,
			({ gh }) =>
				executeUpdateAssignees(gh, args.ownerLogin, args.name, {
					number: args.number,
					assigneesToAdd: args.assigneesToAdd,
					assigneesToRemove: args.assigneesToRemove,
				}),
		);
		yield* ensureWriteSucceeded(result);

		return { correlationId: args.correlationId };
	}),
);

// ---------------------------------------------------------------------------
// 2. Internal action — execute the GitHub API call
// ---------------------------------------------------------------------------

/**
 * Execute a pending write operation by calling the GitHub API.
 * On success/failure, updates optimistic state on domain rows.
 */
const executeWriteOperationDef = factory.internalAction({
	payload: { correlationId: Schema.String, actingUserId: Schema.String },
	success: Schema.Struct({ completed: Schema.Boolean }),
});

executeWriteOperationDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const pendingIssueResult = yield* ctx.runQuery(
			internal.rpc.githubWrite.getPendingIssueCreate,
			{ correlationId: args.correlationId },
		);
		const PendingIssueResultSchema = Schema.Struct({
			found: Schema.Boolean,
			repositoryId: Schema.optional(Schema.Number),
			ownerLogin: Schema.optional(Schema.String),
			repoName: Schema.optional(Schema.String),
			title: Schema.optional(Schema.String),
			body: Schema.optional(Schema.NullOr(Schema.String)),
			labels: Schema.optional(Schema.Array(Schema.String)),
		});
		const pendingIssue = Schema.decodeUnknownSync(PendingIssueResultSchema)(
			pendingIssueResult,
		);

		const token = yield* lookupGitHubTokenByUserIdConfect(
			(query, params) => ctx.runQuery(query, params),
			(mutation, params) => ctx.runMutation(mutation, params),
			args.actingUserId,
		);
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		if (pendingIssue.found) {
			const issueInput = {
				title: pendingIssue.title ?? "",
				body: pendingIssue.body ?? undefined,
				labels: pendingIssue.labels ?? [],
			};

			const issueResult = yield* executeCreateIssue(
				gh,
				pendingIssue.ownerLogin ?? "",
				pendingIssue.repoName ?? "",
				issueInput,
			).pipe(
				Effect.catchAll((error) =>
					Effect.succeed({
						success: false,
						resultData: null,
						entityNumber: null,
						errorStatus: errorStatusFromUnknown(error),
						errorMessage: errorMessageFromUnknown(error),
					}),
				),
			);

			if (issueResult.success && issueResult.resultData !== null) {
				const issueNumber = num(issueResult.resultData.number);
				const issueId = num(issueResult.resultData.issueId);
				if (issueNumber !== null && issueId !== null) {
					yield* ctx.runMutation(
						internal.rpc.githubWrite.markIssueCreateAccepted,
						{
							correlationId: args.correlationId,
							githubIssueId: issueId,
							githubIssueNumber: issueNumber,
						},
					);
					return { completed: true };
				}
			}

			yield* ctx.runMutation(internal.rpc.githubWrite.markIssueCreateFailed, {
				correlationId: args.correlationId,
				errorMessage: issueResult.errorMessage ?? "Unknown error",
				errorStatus: issueResult.errorStatus,
			});
			return { completed: false };
		}

		const pendingCommentResult = yield* ctx.runQuery(
			internal.rpc.githubWrite.getPendingCommentCreate,
			{ correlationId: args.correlationId },
		);
		const PendingCommentResultSchema = Schema.Struct({
			found: Schema.Boolean,
			ownerLogin: Schema.optional(Schema.String),
			repoName: Schema.optional(Schema.String),
			number: Schema.optional(Schema.Number),
			body: Schema.optional(Schema.String),
		});
		const pendingComment = Schema.decodeUnknownSync(PendingCommentResultSchema)(
			pendingCommentResult,
		);
		if (pendingComment.found) {
			const commentResult = yield* executeCreateComment(
				gh,
				pendingComment.ownerLogin ?? "",
				pendingComment.repoName ?? "",
				{
					number: pendingComment.number ?? 0,
					body: pendingComment.body ?? "",
				},
			).pipe(
				Effect.catchAll((error) =>
					Effect.succeed({
						success: false,
						resultData: null,
						entityNumber: null,
						errorStatus: errorStatusFromUnknown(error),
						errorMessage: errorMessageFromUnknown(error),
					}),
				),
			);

			if (commentResult.success && commentResult.resultData !== null) {
				const commentId = num(commentResult.resultData.commentId);
				if (commentId !== null) {
					yield* ctx.runMutation(
						internal.rpc.githubWrite.markCommentCreateAccepted,
						{ correlationId: args.correlationId, githubCommentId: commentId },
					);
					return { completed: true };
				}
			}

			yield* ctx.runMutation(internal.rpc.githubWrite.markCommentCreateFailed, {
				correlationId: args.correlationId,
				errorMessage: commentResult.errorMessage ?? "Unknown error",
				errorStatus: commentResult.errorStatus,
			});
			return { completed: false };
		}

		const pendingStateResult = yield* ctx.runQuery(
			internal.rpc.githubWrite.getPendingIssueStateUpdate,
			{ correlationId: args.correlationId },
		);
		const PendingStateResultSchema = Schema.Struct({
			found: Schema.Boolean,
			ownerLogin: Schema.optional(Schema.String),
			repoName: Schema.optional(Schema.String),
			number: Schema.optional(Schema.Number),
			state: Schema.optional(Schema.Literal("open", "closed")),
		});
		const pendingState = Schema.decodeUnknownSync(PendingStateResultSchema)(
			pendingStateResult,
		);
		if (pendingState.found) {
			const stateResult = yield* executeUpdateIssueState(
				gh,
				pendingState.ownerLogin ?? "",
				pendingState.repoName ?? "",
				{
					number: pendingState.number ?? 0,
					state: pendingState.state ?? "closed",
				},
			).pipe(
				Effect.catchAll((error) =>
					Effect.succeed({
						success: false,
						resultData: null,
						entityNumber: null,
						errorStatus: errorStatusFromUnknown(error),
						errorMessage: errorMessageFromUnknown(error),
					}),
				),
			);

			if (stateResult.success) {
				yield* ctx.runMutation(
					internal.rpc.githubWrite.markIssueStateUpdateAccepted,
					{ correlationId: args.correlationId },
				);
				return { completed: true };
			}

			yield* ctx.runMutation(
				internal.rpc.githubWrite.markIssueStateUpdateFailed,
				{
					correlationId: args.correlationId,
					errorMessage: stateResult.errorMessage ?? "Unknown error",
					errorStatus: stateResult.errorStatus,
				},
			);
			return { completed: false };
		}

		const pendingMergeResult = yield* ctx.runQuery(
			internal.rpc.githubWrite.getPendingPullRequestMerge,
			{ correlationId: args.correlationId },
		);
		const PendingMergeResultSchema = Schema.Struct({
			found: Schema.Boolean,
			ownerLogin: Schema.optional(Schema.String),
			repoName: Schema.optional(Schema.String),
			number: Schema.optional(Schema.Number),
			mergeMethod: Schema.optional(
				Schema.NullOr(Schema.Literal("merge", "squash", "rebase")),
			),
			commitTitle: Schema.optional(Schema.NullOr(Schema.String)),
			commitMessage: Schema.optional(Schema.NullOr(Schema.String)),
		});
		const pendingMerge = Schema.decodeUnknownSync(PendingMergeResultSchema)(
			pendingMergeResult,
		);
		if (pendingMerge.found) {
			const mergeResult = yield* executeMergePullRequest(
				gh,
				pendingMerge.ownerLogin ?? "",
				pendingMerge.repoName ?? "",
				{
					number: pendingMerge.number ?? 0,
					mergeMethod: pendingMerge.mergeMethod ?? undefined,
					commitTitle: pendingMerge.commitTitle ?? undefined,
					commitMessage: pendingMerge.commitMessage ?? undefined,
				},
			).pipe(
				Effect.catchAll((error) =>
					Effect.succeed({
						success: false,
						resultData: null,
						entityNumber: null,
						errorStatus: errorStatusFromUnknown(error),
						errorMessage: errorMessageFromUnknown(error),
					}),
				),
			);

			if (mergeResult.success) {
				yield* ctx.runMutation(
					internal.rpc.githubWrite.markMergePullRequestAccepted,
					{ correlationId: args.correlationId },
				);
				return { completed: true };
			}

			yield* ctx.runMutation(
				internal.rpc.githubWrite.markMergePullRequestFailed,
				{
					correlationId: args.correlationId,
					errorMessage: mergeResult.errorMessage ?? "Unknown error",
					errorStatus: mergeResult.errorStatus,
				},
			);
			return { completed: false };
		}

		const pendingBranchUpdateResult = yield* ctx.runQuery(
			internal.rpc.githubWrite.getPendingPullRequestBranchUpdate,
			{ correlationId: args.correlationId },
		);
		const PendingBranchUpdateResultSchema = Schema.Struct({
			found: Schema.Boolean,
			ownerLogin: Schema.optional(Schema.String),
			repoName: Schema.optional(Schema.String),
			number: Schema.optional(Schema.Number),
			expectedHeadSha: Schema.optional(Schema.NullOr(Schema.String)),
		});
		const pendingBranchUpdate = Schema.decodeUnknownSync(
			PendingBranchUpdateResultSchema,
		)(pendingBranchUpdateResult);
		if (pendingBranchUpdate.found) {
			const branchUpdateResult = yield* executeUpdatePullRequestBranch(
				pendingBranchUpdate.ownerLogin ?? "",
				pendingBranchUpdate.repoName ?? "",
				{
					number: pendingBranchUpdate.number ?? 0,
					expectedHeadSha: pendingBranchUpdate.expectedHeadSha ?? undefined,
				},
				token,
			).pipe(
				Effect.catchAll((error) =>
					Effect.succeed({
						success: false,
						resultData: null,
						entityNumber: null,
						errorStatus: errorStatusFromUnknown(error),
						errorMessage: errorMessageFromUnknown(error),
					}),
				),
			);

			if (branchUpdateResult.success) {
				yield* ctx.runMutation(
					internal.rpc.githubWrite.markPullRequestBranchUpdateAccepted,
					{ correlationId: args.correlationId },
				);
				return { completed: true };
			}

			yield* ctx.runMutation(
				internal.rpc.githubWrite.markPullRequestBranchUpdateFailed,
				{
					correlationId: args.correlationId,
					errorMessage: branchUpdateResult.errorMessage ?? "Unknown error",
					errorStatus: branchUpdateResult.errorStatus,
				},
			);
			return { completed: false };
		}

		const pendingReviewResult = yield* ctx.runQuery(
			internal.rpc.githubWrite.getPendingPrReview,
			{ correlationId: args.correlationId },
		);
		const PendingReviewResultSchema = Schema.Struct({
			found: Schema.Boolean,
			ownerLogin: Schema.optional(Schema.String),
			repoName: Schema.optional(Schema.String),
			number: Schema.optional(Schema.Number),
			event: Schema.optional(
				Schema.Literal("APPROVE", "REQUEST_CHANGES", "COMMENT"),
			),
			body: Schema.optional(Schema.NullOr(Schema.String)),
		});
		const pendingReview = Schema.decodeUnknownSync(PendingReviewResultSchema)(
			pendingReviewResult,
		);
		if (pendingReview.found) {
			const reviewResult = yield* executeSubmitPrReview(
				gh,
				pendingReview.ownerLogin ?? "",
				pendingReview.repoName ?? "",
				{
					number: pendingReview.number ?? 0,
					event: pendingReview.event ?? "COMMENT",
					body: pendingReview.body ?? undefined,
				},
			).pipe(
				Effect.catchAll((error) =>
					Effect.succeed({
						success: false,
						resultData: null,
						entityNumber: null,
						errorStatus: errorStatusFromUnknown(error),
						errorMessage: errorMessageFromUnknown(error),
					}),
				),
			);

			if (reviewResult.success && reviewResult.resultData !== null) {
				const reviewId = num(reviewResult.resultData.reviewId);
				if (reviewId !== null) {
					yield* ctx.runMutation(
						internal.rpc.githubWrite.markPrReviewAccepted,
						{
							correlationId: args.correlationId,
							githubReviewId: reviewId,
						},
					);
					return { completed: true };
				}
			}

			yield* ctx.runMutation(internal.rpc.githubWrite.markPrReviewFailed, {
				correlationId: args.correlationId,
				errorMessage: reviewResult.errorMessage ?? "Unknown error",
				errorStatus: reviewResult.errorStatus,
			});
			return { completed: false };
		}

		const pendingLabelsResult = yield* ctx.runQuery(
			internal.rpc.githubWrite.getPendingLabelsUpdate,
			{ correlationId: args.correlationId },
		);
		const PendingLabelsResultSchema = Schema.Struct({
			found: Schema.Boolean,
			ownerLogin: Schema.optional(Schema.String),
			repoName: Schema.optional(Schema.String),
			number: Schema.optional(Schema.Number),
			labelsToAdd: Schema.optional(Schema.Array(Schema.String)),
			labelsToRemove: Schema.optional(Schema.Array(Schema.String)),
		});
		const pendingLabels = Schema.decodeUnknownSync(PendingLabelsResultSchema)(
			pendingLabelsResult,
		);
		if (pendingLabels.found) {
			const labelsResult = yield* executeUpdateLabels(
				gh,
				pendingLabels.ownerLogin ?? "",
				pendingLabels.repoName ?? "",
				{
					number: pendingLabels.number ?? 0,
					labelsToAdd: pendingLabels.labelsToAdd ?? [],
					labelsToRemove: pendingLabels.labelsToRemove ?? [],
				},
			).pipe(
				Effect.catchAll((error) =>
					Effect.succeed({
						success: false,
						resultData: null,
						entityNumber: null,
						errorStatus: errorStatusFromUnknown(error),
						errorMessage: errorMessageFromUnknown(error),
					}),
				),
			);

			if (labelsResult.success) {
				yield* ctx.runMutation(
					internal.rpc.githubWrite.markLabelsUpdateAccepted,
					{ correlationId: args.correlationId },
				);
				return { completed: true };
			}

			yield* ctx.runMutation(internal.rpc.githubWrite.markLabelsUpdateFailed, {
				correlationId: args.correlationId,
				errorMessage: labelsResult.errorMessage ?? "Unknown error",
				errorStatus: labelsResult.errorStatus,
			});
			return { completed: false };
		}

		const pendingAssigneesResult = yield* ctx.runQuery(
			internal.rpc.githubWrite.getPendingAssigneesUpdate,
			{ correlationId: args.correlationId },
		);
		const PendingAssigneesResultSchema = Schema.Struct({
			found: Schema.Boolean,
			ownerLogin: Schema.optional(Schema.String),
			repoName: Schema.optional(Schema.String),
			number: Schema.optional(Schema.Number),
			assigneesToAdd: Schema.optional(Schema.Array(Schema.String)),
			assigneesToRemove: Schema.optional(Schema.Array(Schema.String)),
		});
		const pendingAssignees = Schema.decodeUnknownSync(
			PendingAssigneesResultSchema,
		)(pendingAssigneesResult);
		if (pendingAssignees.found) {
			const assigneesResult = yield* executeUpdateAssignees(
				gh,
				pendingAssignees.ownerLogin ?? "",
				pendingAssignees.repoName ?? "",
				{
					number: pendingAssignees.number ?? 0,
					assigneesToAdd: pendingAssignees.assigneesToAdd ?? [],
					assigneesToRemove: pendingAssignees.assigneesToRemove ?? [],
				},
			).pipe(
				Effect.catchAll((error) =>
					Effect.succeed({
						success: false,
						resultData: null,
						entityNumber: null,
						errorStatus: errorStatusFromUnknown(error),
						errorMessage: errorMessageFromUnknown(error),
					}),
				),
			);

			if (assigneesResult.success) {
				yield* ctx.runMutation(
					internal.rpc.githubWrite.markAssigneesUpdateAccepted,
					{ correlationId: args.correlationId },
				);
				return { completed: true };
			}

			yield* ctx.runMutation(
				internal.rpc.githubWrite.markAssigneesUpdateFailed,
				{
					correlationId: args.correlationId,
					errorMessage: assigneesResult.errorMessage ?? "Unknown error",
					errorStatus: assigneesResult.errorStatus,
				},
			);
			return { completed: false };
		}

		return { completed: false };
	}).pipe(Effect.catchAll(() => Effect.succeed({ completed: false }))),
);

// ---------------------------------------------------------------------------
// GitHub API execution helpers
// ---------------------------------------------------------------------------

type ExecutionResult = {
	success: boolean;
	resultData: Record<string, unknown> | null;
	entityNumber: number | null;
	errorStatus: number;
	errorMessage: string | null;
};

type GHClient = {
	client: GitHubClient;
};

const failedResult = (
	errorMessage: string,
	errorStatus = 0,
): ExecutionResult => ({
	success: false,
	resultData: null,
	entityNumber: null,
	errorStatus,
	errorMessage,
});

const errorStatusFromUnknown = (error: unknown): number => {
	if (typeof error !== "object" || error === null) return 0;
	if ("status" in error && typeof error.status === "number") {
		return error.status;
	}
	if (
		"response" in error &&
		typeof error.response === "object" &&
		error.response !== null &&
		"status" in error.response &&
		typeof error.response.status === "number"
	) {
		return error.response.status;
	}
	return 0;
};

const errorMessageFromUnknown = (error: unknown): string => {
	if (typeof error !== "object" || error === null) return String(error);
	if ("message" in error && typeof error.message === "string") {
		return error.message;
	}
	if (
		"cause" in error &&
		typeof error.cause === "object" &&
		error.cause !== null &&
		"message" in error.cause &&
		typeof error.cause.message === "string"
	) {
		return error.cause.message;
	}
	return String(error);
};

const toStringArray = (value: unknown): Array<string> => {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
};

const parseJsonObject = (
	json: string | null | undefined,
): Record<string, unknown> => {
	if (json === null || json === undefined) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null) return {};
	const record: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(parsed)) {
		record[key] = value;
	}
	return record;
};

const executeCreateIssue = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const title = typeof input.title === "string" ? input.title : "";
		const body = typeof input.body === "string" ? input.body : undefined;
		const labels =
			Array.isArray(input.labels) &&
			input.labels.length > 0 &&
			input.labels.every((label) => typeof label === "string")
				? input.labels
				: undefined;

		const issue = yield* gh.client.issuesCreate(ownerLogin, repoName, {
			payload: { title, body, labels },
		});

		return {
			success: true,
			resultData: {
				issueId: issue.id,
				number: issue.number,
				htmlUrl: issue.html_url,
			},
			entityNumber: issue.number,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchAll((e) =>
			Effect.succeed(
				failedResult(errorMessageFromUnknown(e), errorStatusFromUnknown(e)),
			),
		),
	);

const executeCreateComment = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const issueNumber = num(input.number) ?? 0;
		const body = typeof input.body === "string" ? input.body : "";

		const comment = yield* gh.client.issuesCreateComment(
			ownerLogin,
			repoName,
			String(issueNumber),
			{ payload: { body } },
		);

		return {
			success: true,
			resultData: {
				commentId: comment.id,
				htmlUrl: comment.html_url,
			},
			entityNumber: issueNumber,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchAll((e) =>
			Effect.succeed(
				failedResult(errorMessageFromUnknown(e), errorStatusFromUnknown(e)),
			),
		),
	);

const executeUpdateIssueState = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const issueNumber = num(input.number) ?? 0;
		const state =
			input.state === "open" || input.state === "closed"
				? input.state
				: "closed";

		const updated = yield* gh.client.issuesUpdate(
			ownerLogin,
			repoName,
			String(issueNumber),
			{ payload: { state } },
		);

		// issuesUpdate can return Issue | BasicError — check for number field
		const returnedNumber =
			"number" in updated && typeof updated.number === "number"
				? updated.number
				: issueNumber;
		const returnedState =
			"state" in updated && typeof updated.state === "string"
				? updated.state
				: state;

		return {
			success: true,
			resultData: {
				number: returnedNumber,
				state: returnedState === "open" ? "open" : "closed",
			},
			entityNumber: issueNumber,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchAll((e) =>
			Effect.succeed(
				failedResult(errorMessageFromUnknown(e), errorStatusFromUnknown(e)),
			),
		),
	);

const executeMergePullRequest = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const prNumber = num(input.number) ?? 0;
		const mergeMethod =
			input.mergeMethod === "merge" ||
			input.mergeMethod === "squash" ||
			input.mergeMethod === "rebase"
				? input.mergeMethod
				: undefined;
		const commitTitle =
			typeof input.commitTitle === "string" ? input.commitTitle : undefined;
		const commitMessage =
			typeof input.commitMessage === "string" ? input.commitMessage : undefined;

		const result = yield* gh.client.pullsMerge(
			ownerLogin,
			repoName,
			String(prNumber),
			{
				payload: {
					merge_method: mergeMethod,
					commit_title: commitTitle,
					commit_message: commitMessage,
				},
			},
		);

		return {
			success: true,
			resultData: {
				merged: result.merged,
				sha: result.sha,
				message: result.message,
			},
			entityNumber: prNumber,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchAll((e) =>
			Effect.succeed(
				failedResult(errorMessageFromUnknown(e), errorStatusFromUnknown(e)),
			),
		),
	);

const executeUpdatePullRequestBranch = (
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
	token: string,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const prNumber = num(input.number) ?? 0;
		const expectedHeadSha =
			typeof input.expectedHeadSha === "string" ? input.expectedHeadSha : null;
		const payload =
			expectedHeadSha === null ? {} : { expected_head_sha: expectedHeadSha };
		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(
					`https://api.github.com/repos/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repoName)}/pulls/${String(prNumber)}/update-branch`,
					{
						method: "PUT",
						headers: {
							Authorization: `Bearer ${token}`,
							Accept: "application/vnd.github+json",
							"X-GitHub-Api-Version": "2022-11-28",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				),
			catch: (error) => new Error(String(error)),
		});

		const responseText = yield* Effect.tryPromise({
			try: () => response.text(),
			catch: (error) => new Error(String(error)),
		});
		const parsedBody = parseJsonObject(responseText);
		const message =
			typeof parsedBody.message === "string"
				? parsedBody.message
				: "Pull request branch update queued";

		if (response.status >= 200 && response.status < 300) {
			return {
				success: true,
				resultData: {
					number: prNumber,
					message,
				},
				entityNumber: prNumber,
				errorStatus: 0,
				errorMessage: null,
			};
		}

		return failedResult(message, response.status);
	}).pipe(
		Effect.catchAll((error) =>
			Effect.succeed(
				failedResult(
					errorMessageFromUnknown(error),
					errorStatusFromUnknown(error),
				),
			),
		),
	);

const executeSubmitPrReview = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const prNumber = num(input.number) ?? 0;
		const event =
			input.event === "APPROVE" ||
			input.event === "REQUEST_CHANGES" ||
			input.event === "COMMENT"
				? input.event
				: "COMMENT";
		const body = typeof input.body === "string" ? input.body : undefined;

		const review = yield* gh.client.pullsCreateReview(
			ownerLogin,
			repoName,
			String(prNumber),
			{
				payload: { event, body },
			},
		);

		return {
			success: true,
			resultData: {
				reviewId: review.id,
				state: review.state,
			},
			entityNumber: prNumber,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchAll((e) =>
			Effect.succeed(
				failedResult(errorMessageFromUnknown(e), errorStatusFromUnknown(e)),
			),
		),
	);

const executeUpdateLabels = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const issueNumber = num(input.number) ?? 0;
		const labelsToAdd = toStringArray(input.labelsToAdd);
		const labelsToRemove = toStringArray(input.labelsToRemove);

		if (labelsToAdd.length > 0) {
			yield* gh.client.issuesAddLabels(
				ownerLogin,
				repoName,
				String(issueNumber),
				{
					payload: labelsToAdd,
				},
			);
		}

		for (const label of labelsToRemove) {
			yield* gh.client.issuesRemoveLabel(
				ownerLogin,
				repoName,
				String(issueNumber),
				encodeURIComponent(label),
			);
		}

		return {
			success: true,
			resultData: {
				number: issueNumber,
				labelsAdded: labelsToAdd,
				labelsRemoved: labelsToRemove,
			},
			entityNumber: issueNumber,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchAll((e) =>
			Effect.succeed(
				failedResult(errorMessageFromUnknown(e), errorStatusFromUnknown(e)),
			),
		),
	);

const executeUpdateAssignees = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const issueNumber = num(input.number) ?? 0;
		const assigneesToAdd = toStringArray(input.assigneesToAdd);
		const assigneesToRemove = toStringArray(input.assigneesToRemove);

		if (assigneesToAdd.length > 0) {
			yield* gh.client.issuesAddAssignees(
				ownerLogin,
				repoName,
				String(issueNumber),
				{ payload: { assignees: assigneesToAdd } },
			);
		}

		if (assigneesToRemove.length > 0) {
			yield* gh.client.issuesRemoveAssignees(
				ownerLogin,
				repoName,
				String(issueNumber),
				{ payload: { assignees: assigneesToRemove } },
			);
		}

		return {
			success: true,
			resultData: {
				number: issueNumber,
				assigneesAdded: assigneesToAdd,
				assigneesRemoved: assigneesToRemove,
			},
			entityNumber: issueNumber,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchAll((e) =>
			Effect.succeed(
				failedResult(errorMessageFromUnknown(e), errorStatusFromUnknown(e)),
			),
		),
	);

// ---------------------------------------------------------------------------
// 3. Internal mutations — mark completed / failed / confirmed
// ---------------------------------------------------------------------------

const markIssueCreateAcceptedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		githubIssueId: Schema.Number,
		githubIssueNumber: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markIssueCreateAcceptedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(issue)) return { updated: false };

		yield* ctx.db.patch(issue.value._id, {
			githubIssueId: args.githubIssueId,
			number: args.githubIssueNumber,
			optimisticState: "pending",
			optimisticErrorMessage: null,
			optimisticErrorStatus: null,
			optimisticUpdatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

const markIssueCreateFailedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		errorMessage: Schema.String,
		errorStatus: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markIssueCreateFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(issue)) return { updated: false };

		yield* ctx.db.patch(issue.value._id, {
			optimisticState: "failed",
			optimisticErrorMessage: args.errorMessage,
			optimisticErrorStatus: args.errorStatus,
			optimisticUpdatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

const markCommentCreateAcceptedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		githubCommentId: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markCommentCreateAcceptedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const comment = yield* ctx.db
			.query("github_issue_comments")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(comment)) return { updated: false };

		yield* ctx.db.patch(comment.value._id, {
			githubCommentId: args.githubCommentId,
			optimisticState: "pending",
			optimisticErrorMessage: null,
			optimisticErrorStatus: null,
			optimisticUpdatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

const markCommentCreateFailedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		errorMessage: Schema.String,
		errorStatus: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markCommentCreateFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const comment = yield* ctx.db
			.query("github_issue_comments")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(comment)) return { updated: false };

		yield* ctx.db.patch(comment.value._id, {
			optimisticState: "failed",
			optimisticErrorMessage: args.errorMessage,
			optimisticErrorStatus: args.errorStatus,
			optimisticUpdatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

const markIssueStateUpdateAcceptedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markIssueStateUpdateAcceptedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (Option.isSome(issue)) {
			yield* ctx.db.patch(issue.value._id, {
				optimisticState: "pending",
				optimisticErrorMessage: null,
				optimisticErrorStatus: null,
				optimisticUpdatedAt: Date.now(),
			});
			return { updated: true };
		}

		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (Option.isNone(pr)) return { updated: false };

		yield* ctx.db.patch(pr.value._id, {
			optimisticState: "pending",
			optimisticErrorMessage: null,
			optimisticErrorStatus: null,
			optimisticUpdatedAt: Date.now(),
		});
		return { updated: true };
	}),
);

const markIssueStateUpdateFailedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		errorMessage: Schema.String,
		errorStatus: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markIssueStateUpdateFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (Option.isSome(issue)) {
			yield* ctx.db.patch(issue.value._id, {
				optimisticState: "failed",
				optimisticErrorMessage: args.errorMessage,
				optimisticErrorStatus: args.errorStatus,
				optimisticUpdatedAt: Date.now(),
			});
			return { updated: true };
		}

		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (Option.isNone(pr)) return { updated: false };

		yield* ctx.db.patch(pr.value._id, {
			optimisticState: "failed",
			optimisticErrorMessage: args.errorMessage,
			optimisticErrorStatus: args.errorStatus,
			optimisticUpdatedAt: Date.now(),
		});
		return { updated: true };
	}),
);

const markMergePullRequestAcceptedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markMergePullRequestAcceptedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(pr)) return { updated: false };

		yield* ctx.db.patch(pr.value._id, {
			optimisticState: "pending",
			optimisticErrorMessage: null,
			optimisticErrorStatus: null,
			optimisticUpdatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

const markMergePullRequestFailedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		errorMessage: Schema.String,
		errorStatus: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markMergePullRequestFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(pr)) return { updated: false };

		yield* ctx.db.patch(pr.value._id, {
			optimisticState: "failed",
			optimisticErrorMessage: args.errorMessage,
			optimisticErrorStatus: args.errorStatus,
			optimisticUpdatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

const markPullRequestBranchUpdateAcceptedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markPullRequestBranchUpdateAcceptedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (
			Option.isNone(pr) ||
			pr.value.optimisticOperationType !== "update_pull_request_branch"
		) {
			return { updated: false };
		}

		yield* ctx.db.patch(pr.value._id, {
			optimisticState: "pending",
			optimisticErrorMessage: null,
			optimisticErrorStatus: null,
			optimisticUpdatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

const markPullRequestBranchUpdateFailedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		errorMessage: Schema.String,
		errorStatus: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markPullRequestBranchUpdateFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (
			Option.isNone(pr) ||
			pr.value.optimisticOperationType !== "update_pull_request_branch"
		) {
			return { updated: false };
		}

		yield* ctx.db.patch(pr.value._id, {
			optimisticState: "failed",
			optimisticErrorMessage: args.errorMessage,
			optimisticErrorStatus: args.errorStatus,
			optimisticUpdatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

const markPrReviewAcceptedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		githubReviewId: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markPrReviewAcceptedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const review = yield* ctx.db
			.query("github_pull_request_reviews")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(review)) return { updated: false };

		yield* ctx.db.patch(review.value._id, {
			githubReviewId: args.githubReviewId,
			optimisticState: "pending",
			optimisticErrorMessage: null,
			optimisticErrorStatus: null,
			optimisticUpdatedAt: Date.now(),
		});
		return { updated: true };
	}),
);

const markPrReviewFailedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		errorMessage: Schema.String,
		errorStatus: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markPrReviewFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const review = yield* ctx.db
			.query("github_pull_request_reviews")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(review)) return { updated: false };

		yield* ctx.db.patch(review.value._id, {
			optimisticState: "failed",
			optimisticErrorMessage: args.errorMessage,
			optimisticErrorStatus: args.errorStatus,
			optimisticUpdatedAt: Date.now(),
		});
		return { updated: true };
	}),
);

const markLabelsUpdateAcceptedDef = factory.internalMutation({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markLabelsUpdateAcceptedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let updated = false;

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(issue) &&
			issue.value.optimisticOperationType === "update_labels"
		) {
			yield* ctx.db.patch(issue.value._id, {
				optimisticState: "pending",
				optimisticErrorMessage: null,
				optimisticErrorStatus: null,
				optimisticUpdatedAt: Date.now(),
			});
			updated = true;
		}

		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(pr) &&
			pr.value.optimisticOperationType === "update_labels"
		) {
			yield* ctx.db.patch(pr.value._id, {
				optimisticState: "pending",
				optimisticErrorMessage: null,
				optimisticErrorStatus: null,
				optimisticUpdatedAt: Date.now(),
			});
			updated = true;
		}

		return { updated };
	}),
);

const markLabelsUpdateFailedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		errorMessage: Schema.String,
		errorStatus: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markLabelsUpdateFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let updated = false;

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(issue) &&
			issue.value.optimisticOperationType === "update_labels"
		) {
			yield* ctx.db.patch(issue.value._id, {
				optimisticState: "failed",
				optimisticErrorMessage: args.errorMessage,
				optimisticErrorStatus: args.errorStatus,
				optimisticUpdatedAt: Date.now(),
			});
			updated = true;
		}

		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(pr) &&
			pr.value.optimisticOperationType === "update_labels"
		) {
			yield* ctx.db.patch(pr.value._id, {
				optimisticState: "failed",
				optimisticErrorMessage: args.errorMessage,
				optimisticErrorStatus: args.errorStatus,
				optimisticUpdatedAt: Date.now(),
			});
			updated = true;
		}

		return { updated };
	}),
);

const markAssigneesUpdateAcceptedDef = factory.internalMutation({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markAssigneesUpdateAcceptedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let updated = false;

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(issue) &&
			issue.value.optimisticOperationType === "update_assignees"
		) {
			yield* ctx.db.patch(issue.value._id, {
				optimisticState: "pending",
				optimisticErrorMessage: null,
				optimisticErrorStatus: null,
				optimisticUpdatedAt: Date.now(),
			});
			updated = true;
		}

		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(pr) &&
			pr.value.optimisticOperationType === "update_assignees"
		) {
			yield* ctx.db.patch(pr.value._id, {
				optimisticState: "pending",
				optimisticErrorMessage: null,
				optimisticErrorStatus: null,
				optimisticUpdatedAt: Date.now(),
			});
			updated = true;
		}

		return { updated };
	}),
);

const markAssigneesUpdateFailedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		errorMessage: Schema.String,
		errorStatus: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markAssigneesUpdateFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let updated = false;

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(issue) &&
			issue.value.optimisticOperationType === "update_assignees"
		) {
			yield* ctx.db.patch(issue.value._id, {
				optimisticState: "failed",
				optimisticErrorMessage: args.errorMessage,
				optimisticErrorStatus: args.errorStatus,
				optimisticUpdatedAt: Date.now(),
			});
			updated = true;
		}

		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(pr) &&
			pr.value.optimisticOperationType === "update_assignees"
		) {
			yield* ctx.db.patch(pr.value._id, {
				optimisticState: "failed",
				optimisticErrorMessage: args.errorMessage,
				optimisticErrorStatus: args.errorStatus,
				optimisticUpdatedAt: Date.now(),
			});
			updated = true;
		}

		return { updated };
	}),
);

// ---------------------------------------------------------------------------
// 4. Internal query — read operation (used by the action)
// ---------------------------------------------------------------------------

const getPendingIssueCreateDef = factory.internalQuery({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		repositoryId: Schema.optional(Schema.Number),
		ownerLogin: Schema.optional(Schema.String),
		repoName: Schema.optional(Schema.String),
		title: Schema.optional(Schema.String),
		body: Schema.optional(Schema.NullOr(Schema.String)),
		labels: Schema.optional(Schema.Array(Schema.String)),
	}),
});

getPendingIssueCreateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(issue)) return { found: false };
		if (issue.value.optimisticOperationType !== "create_issue") {
			return { found: false };
		}
		if (issue.value.optimisticState !== "pending") return { found: false };

		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) =>
				q.eq("githubRepoId", issue.value.repositoryId),
			)
			.first();

		if (Option.isNone(repo)) return { found: false };

		return {
			found: true,
			repositoryId: issue.value.repositoryId,
			ownerLogin: repo.value.ownerLogin,
			repoName: repo.value.name,
			title: issue.value.title,
			body: issue.value.body,
			labels: [...issue.value.labelNames],
		};
	}),
);

const getPendingCommentCreateDef = factory.internalQuery({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		ownerLogin: Schema.optional(Schema.String),
		repoName: Schema.optional(Schema.String),
		number: Schema.optional(Schema.Number),
		body: Schema.optional(Schema.String),
	}),
});

getPendingCommentCreateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const comment = yield* ctx.db
			.query("github_issue_comments")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(comment)) return { found: false };
		if (comment.value.optimisticOperationType !== "create_comment") {
			return { found: false };
		}
		if (comment.value.optimisticState !== "pending") return { found: false };

		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) =>
				q.eq("githubRepoId", comment.value.repositoryId),
			)
			.first();
		if (Option.isNone(repo)) return { found: false };

		return {
			found: true,
			ownerLogin: repo.value.ownerLogin,
			repoName: repo.value.name,
			number: comment.value.issueNumber,
			body: comment.value.body,
		};
	}),
);

const getPendingIssueStateUpdateDef = factory.internalQuery({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		ownerLogin: Schema.optional(Schema.String),
		repoName: Schema.optional(Schema.String),
		number: Schema.optional(Schema.Number),
		state: Schema.optional(Schema.Literal("open", "closed")),
	}),
});

getPendingIssueStateUpdateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(issue) &&
			issue.value.optimisticOperationType === "update_issue_state" &&
			issue.value.optimisticState === "pending"
		) {
			const repo = yield* ctx.db
				.query("github_repositories")
				.withIndex("by_githubRepoId", (q) =>
					q.eq("githubRepoId", issue.value.repositoryId),
				)
				.first();
			if (Option.isNone(repo)) return { found: false };
			return {
				found: true,
				ownerLogin: repo.value.ownerLogin,
				repoName: repo.value.name,
				number: issue.value.number,
				state: issue.value.state,
			};
		}

		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(pr) &&
			pr.value.optimisticOperationType === "update_issue_state" &&
			pr.value.optimisticState === "pending"
		) {
			const repo = yield* ctx.db
				.query("github_repositories")
				.withIndex("by_githubRepoId", (q) =>
					q.eq("githubRepoId", pr.value.repositoryId),
				)
				.first();
			if (Option.isNone(repo)) return { found: false };
			return {
				found: true,
				ownerLogin: repo.value.ownerLogin,
				repoName: repo.value.name,
				number: pr.value.number,
				state: pr.value.state,
			};
		}

		return { found: false };
	}),
);

const getPendingPullRequestMergeDef = factory.internalQuery({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		ownerLogin: Schema.optional(Schema.String),
		repoName: Schema.optional(Schema.String),
		number: Schema.optional(Schema.Number),
		mergeMethod: Schema.optional(
			Schema.NullOr(Schema.Literal("merge", "squash", "rebase")),
		),
		commitTitle: Schema.optional(Schema.NullOr(Schema.String)),
		commitMessage: Schema.optional(Schema.NullOr(Schema.String)),
	}),
});

getPendingPullRequestMergeDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(pr)) return { found: false };
		if (pr.value.optimisticOperationType !== "merge_pull_request") {
			return { found: false };
		}
		if (pr.value.optimisticState !== "pending") return { found: false };

		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) =>
				q.eq("githubRepoId", pr.value.repositoryId),
			)
			.first();
		if (Option.isNone(repo)) return { found: false };

		const payloadJson = pr.value.optimisticPayloadJson ?? "{}";
		const parsed = parseJsonObject(payloadJson);
		const mergeMethod =
			parsed.mergeMethod === "merge" ||
			parsed.mergeMethod === "squash" ||
			parsed.mergeMethod === "rebase"
				? parsed.mergeMethod
				: null;
		const commitTitle =
			typeof parsed.commitTitle === "string" ? parsed.commitTitle : null;
		const commitMessage =
			typeof parsed.commitMessage === "string" ? parsed.commitMessage : null;

		return {
			found: true,
			ownerLogin: repo.value.ownerLogin,
			repoName: repo.value.name,
			number: pr.value.number,
			mergeMethod,
			commitTitle,
			commitMessage,
		};
	}),
);

const getPendingPullRequestBranchUpdateDef = factory.internalQuery({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		ownerLogin: Schema.optional(Schema.String),
		repoName: Schema.optional(Schema.String),
		number: Schema.optional(Schema.Number),
		expectedHeadSha: Schema.optional(Schema.NullOr(Schema.String)),
	}),
});

getPendingPullRequestBranchUpdateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(pr)) return { found: false };
		if (pr.value.optimisticOperationType !== "update_pull_request_branch") {
			return { found: false };
		}
		if (pr.value.optimisticState !== "pending") return { found: false };

		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) =>
				q.eq("githubRepoId", pr.value.repositoryId),
			)
			.first();
		if (Option.isNone(repo)) return { found: false };

		const payload = parseJsonObject(pr.value.optimisticPayloadJson);
		const expectedHeadSha =
			typeof payload.expectedHeadSha === "string"
				? payload.expectedHeadSha
				: null;

		return {
			found: true,
			ownerLogin: repo.value.ownerLogin,
			repoName: repo.value.name,
			number: pr.value.number,
			expectedHeadSha,
		};
	}),
);

const getPendingPrReviewDef = factory.internalQuery({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		ownerLogin: Schema.optional(Schema.String),
		repoName: Schema.optional(Schema.String),
		number: Schema.optional(Schema.Number),
		event: Schema.optional(
			Schema.Literal("APPROVE", "REQUEST_CHANGES", "COMMENT"),
		),
		body: Schema.optional(Schema.NullOr(Schema.String)),
	}),
});

getPendingPrReviewDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const review = yield* ctx.db
			.query("github_pull_request_reviews")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();

		if (Option.isNone(review)) return { found: false };
		if (review.value.optimisticOperationType !== "submit_pr_review") {
			return { found: false };
		}
		if (review.value.optimisticState !== "pending") return { found: false };

		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) =>
				q.eq("githubRepoId", review.value.repositoryId),
			)
			.first();
		if (Option.isNone(repo)) return { found: false };

		const parsedPayload = parseJsonObject(review.value.optimisticPayloadJson);
		const event =
			typeof parsedPayload.event === "string" &&
			(parsedPayload.event === "APPROVE" ||
				parsedPayload.event === "REQUEST_CHANGES" ||
				parsedPayload.event === "COMMENT")
				? parsedPayload.event
				: review.value.state === "APPROVED"
					? "APPROVE"
					: review.value.state === "CHANGES_REQUESTED"
						? "REQUEST_CHANGES"
						: "COMMENT";
		const body =
			typeof parsedPayload.body === "string" ? parsedPayload.body : null;

		return {
			found: true,
			ownerLogin: repo.value.ownerLogin,
			repoName: repo.value.name,
			number: review.value.pullRequestNumber,
			event,
			body,
		};
	}),
);

const getPendingLabelsUpdateDef = factory.internalQuery({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		ownerLogin: Schema.optional(Schema.String),
		repoName: Schema.optional(Schema.String),
		number: Schema.optional(Schema.Number),
		labelsToAdd: Schema.optional(Schema.Array(Schema.String)),
		labelsToRemove: Schema.optional(Schema.Array(Schema.String)),
	}),
});

getPendingLabelsUpdateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(issue) &&
			issue.value.optimisticOperationType === "update_labels" &&
			issue.value.optimisticState === "pending"
		) {
			const repo = yield* ctx.db
				.query("github_repositories")
				.withIndex("by_githubRepoId", (q) =>
					q.eq("githubRepoId", issue.value.repositoryId),
				)
				.first();
			if (Option.isNone(repo)) return { found: false };

			const parsedPayload = parseJsonObject(issue.value.optimisticPayloadJson);
			const labelsToAdd = toStringArray(parsedPayload.labelsToAdd);
			const labelsToRemove = toStringArray(parsedPayload.labelsToRemove);

			return {
				found: true,
				ownerLogin: repo.value.ownerLogin,
				repoName: repo.value.name,
				number: issue.value.number,
				labelsToAdd,
				labelsToRemove,
			};
		}

		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(pr) &&
			pr.value.optimisticOperationType === "update_labels" &&
			pr.value.optimisticState === "pending"
		) {
			const repo = yield* ctx.db
				.query("github_repositories")
				.withIndex("by_githubRepoId", (q) =>
					q.eq("githubRepoId", pr.value.repositoryId),
				)
				.first();
			if (Option.isNone(repo)) return { found: false };

			const parsedPayload = parseJsonObject(pr.value.optimisticPayloadJson);
			const labelsToAdd = toStringArray(parsedPayload.labelsToAdd);
			const labelsToRemove = toStringArray(parsedPayload.labelsToRemove);

			return {
				found: true,
				ownerLogin: repo.value.ownerLogin,
				repoName: repo.value.name,
				number: pr.value.number,
				labelsToAdd,
				labelsToRemove,
			};
		}

		return { found: false };
	}),
);

const getPendingAssigneesUpdateDef = factory.internalQuery({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		ownerLogin: Schema.optional(Schema.String),
		repoName: Schema.optional(Schema.String),
		number: Schema.optional(Schema.Number),
		assigneesToAdd: Schema.optional(Schema.Array(Schema.String)),
		assigneesToRemove: Schema.optional(Schema.Array(Schema.String)),
	}),
});

getPendingAssigneesUpdateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(issue) &&
			issue.value.optimisticOperationType === "update_assignees" &&
			issue.value.optimisticState === "pending"
		) {
			const repo = yield* ctx.db
				.query("github_repositories")
				.withIndex("by_githubRepoId", (q) =>
					q.eq("githubRepoId", issue.value.repositoryId),
				)
				.first();
			if (Option.isNone(repo)) return { found: false };

			const parsedPayload = parseJsonObject(issue.value.optimisticPayloadJson);
			const assigneesToAdd = toStringArray(parsedPayload.assigneesToAdd);
			const assigneesToRemove = toStringArray(parsedPayload.assigneesToRemove);

			return {
				found: true,
				ownerLogin: repo.value.ownerLogin,
				repoName: repo.value.name,
				number: issue.value.number,
				assigneesToAdd,
				assigneesToRemove,
			};
		}

		const pr = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_optimisticCorrelationId", (q) =>
				q.eq("optimisticCorrelationId", args.correlationId),
			)
			.first();
		if (
			Option.isSome(pr) &&
			pr.value.optimisticOperationType === "update_assignees" &&
			pr.value.optimisticState === "pending"
		) {
			const repo = yield* ctx.db
				.query("github_repositories")
				.withIndex("by_githubRepoId", (q) =>
					q.eq("githubRepoId", pr.value.repositoryId),
				)
				.first();
			if (Option.isNone(repo)) return { found: false };

			const parsedPayload = parseJsonObject(pr.value.optimisticPayloadJson);
			const assigneesToAdd = toStringArray(parsedPayload.assigneesToAdd);
			const assigneesToRemove = toStringArray(parsedPayload.assigneesToRemove);

			return {
				found: true,
				ownerLogin: repo.value.ownerLogin,
				repoName: repo.value.name,
				number: pr.value.number,
				assigneesToAdd,
				assigneesToRemove,
			};
		}

		return { found: false };
	}),
);

// ---------------------------------------------------------------------------
// 5. Public query — list write operations for a repo
// ---------------------------------------------------------------------------

const listWriteOperationsDef = factory
	.query({
		payload: {
			repositoryId: Schema.Number,
			/** Optionally filter by state */
			stateFilter: Schema.optional(OperationState),
		},
		success: Schema.Array(WriteOperation),
	})
	.middleware(ReadGitHubRepoByIdMiddleware);

listWriteOperationsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const permission = yield* ReadGitHubRepoPermission;
		if (!permission.isAllowed || permission.repository === null) {
			return [];
		}

		const repositoryId = permission.repository.repositoryId;
		const ownerLogin = permission.repository.ownerLogin;
		const repoName = permission.repository.name;

		const issueRows = yield* ctx.db
			.query("github_issues")
			.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.order("desc")
			.take(100);

		const issueOps = issueRows
			.map((issue) => {
				const correlationId = issue.optimisticCorrelationId;
				const operationType = issue.optimisticOperationType;
				const optimisticState = issue.optimisticState;
				const payload = parseJsonObject(issue.optimisticPayloadJson);
				const labelsToAdd = toStringArray(payload.labelsToAdd);
				const labelsToRemove = toStringArray(payload.labelsToRemove);
				const assigneesToAdd = toStringArray(payload.assigneesToAdd);
				const assigneesToRemove = toStringArray(payload.assigneesToRemove);
				if (correlationId === null || correlationId === undefined) return null;
				if (
					operationType !== "create_issue" &&
					operationType !== "update_issue_state" &&
					operationType !== "update_labels" &&
					operationType !== "update_assignees"
				)
					return null;
				if (
					optimisticState !== "pending" &&
					optimisticState !== "failed" &&
					optimisticState !== "confirmed"
				) {
					return null;
				}
				const inputPayload =
					operationType === "create_issue"
						? {
								ownerLogin,
								name: repoName,
								title: issue.title,
								body: issue.body,
								labels: [...issue.labelNames],
							}
						: operationType === "update_issue_state"
							? {
									ownerLogin,
									name: repoName,
									number: issue.number,
									state: issue.state,
								}
							: operationType === "update_labels"
								? {
										ownerLogin,
										name: repoName,
										number: issue.number,
										labelsToAdd,
										labelsToRemove,
									}
								: {
										ownerLogin,
										name: repoName,
										number: issue.number,
										assigneesToAdd,
										assigneesToRemove,
									};
				const optimisticData =
					operationType === "create_issue"
						? {
								title: issue.title,
								body: issue.body,
								labels: [...issue.labelNames],
							}
						: operationType === "update_issue_state"
							? {
									number: issue.number,
									state: issue.state,
								}
							: operationType === "update_labels"
								? {
										number: issue.number,
										labelNames: [...issue.labelNames],
										labelsToAdd,
										labelsToRemove,
									}
								: {
										number: issue.number,
										assigneeUserIds: [...issue.assigneeUserIds],
										assigneesToAdd,
										assigneesToRemove,
									};

				return {
					_id: String(issue._id),
					_creationTime: issue._creationTime,
					correlationId,
					operationType,
					state: optimisticState,
					repositoryId: issue.repositoryId,
					ownerLogin,
					repoName,
					inputPayloadJson: JSON.stringify(inputPayload),
					optimisticDataJson: JSON.stringify(optimisticData),
					resultDataJson:
						issue.number > 0
							? JSON.stringify(
									operationType === "create_issue"
										? { number: issue.number }
										: operationType === "update_issue_state"
											? { number: issue.number, state: issue.state }
											: operationType === "update_labels"
												? {
														number: issue.number,
														labelNames: [...issue.labelNames],
													}
												: {
														number: issue.number,
														assigneeUserIds: [...issue.assigneeUserIds],
													},
								)
							: null,
					errorMessage: issue.optimisticErrorMessage ?? null,
					errorStatus: issue.optimisticErrorStatus ?? null,
					githubEntityNumber: issue.number > 0 ? issue.number : null,
					createdAt: issue._creationTime,
					updatedAt: issue.optimisticUpdatedAt ?? issue.githubUpdatedAt,
				};
			})
			.filter((op) => op !== null)
			.filter((op) =>
				args.stateFilter === undefined ? true : op.state === args.stateFilter,
			);

		const commentRows = yield* ctx.db
			.query("github_issue_comments")
			.withIndex("by_repositoryId_and_issueNumber", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.take(200);

		const commentOps = commentRows
			.map((comment) => {
				const correlationId = comment.optimisticCorrelationId;
				const optimisticState = comment.optimisticState;
				if (correlationId === null || correlationId === undefined) return null;
				if (comment.optimisticOperationType !== "create_comment") return null;
				if (
					optimisticState !== "pending" &&
					optimisticState !== "failed" &&
					optimisticState !== "confirmed"
				) {
					return null;
				}

				const inputPayload = {
					ownerLogin,
					name: repoName,
					number: comment.issueNumber,
					body: comment.body,
				};
				const optimisticData = {
					number: comment.issueNumber,
					body: comment.body,
				};

				return {
					_id: String(comment._id),
					_creationTime: comment._creationTime,
					correlationId,
					operationType: "create_comment",
					state: optimisticState,
					repositoryId: comment.repositoryId,
					ownerLogin,
					repoName,
					inputPayloadJson: JSON.stringify(inputPayload),
					optimisticDataJson: JSON.stringify(optimisticData),
					resultDataJson:
						comment.githubCommentId > 0
							? JSON.stringify({ commentId: comment.githubCommentId })
							: null,
					errorMessage: comment.optimisticErrorMessage ?? null,
					errorStatus: comment.optimisticErrorStatus ?? null,
					githubEntityNumber:
						comment.issueNumber > 0 ? comment.issueNumber : null,
					createdAt: comment.createdAt,
					updatedAt: comment.optimisticUpdatedAt ?? comment.updatedAt,
				};
			})
			.filter((op) => op !== null)
			.filter((op) =>
				args.stateFilter === undefined ? true : op.state === args.stateFilter,
			);

		const prRows = yield* ctx.db
			.query("github_pull_requests")
			.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.order("desc")
			.take(100);

		const prOps = prRows
			.map((pr) => {
				const correlationId = pr.optimisticCorrelationId;
				const operationType = pr.optimisticOperationType;
				const optimisticState = pr.optimisticState;
				if (correlationId === null || correlationId === undefined) return null;
				if (
					operationType !== "update_issue_state" &&
					operationType !== "merge_pull_request" &&
					operationType !== "update_pull_request_branch" &&
					operationType !== "update_labels" &&
					operationType !== "update_assignees"
				) {
					return null;
				}
				if (
					optimisticState !== "pending" &&
					optimisticState !== "failed" &&
					optimisticState !== "confirmed"
				) {
					return null;
				}
				const payload = parseJsonObject(pr.optimisticPayloadJson);
				const labelsToAdd = toStringArray(payload.labelsToAdd);
				const labelsToRemove = toStringArray(payload.labelsToRemove);
				const assigneesToAdd = toStringArray(payload.assigneesToAdd);
				const assigneesToRemove = toStringArray(payload.assigneesToRemove);
				const expectedHeadSha =
					typeof payload.expectedHeadSha === "string"
						? payload.expectedHeadSha
						: null;

				const inputPayload =
					operationType === "merge_pull_request"
						? {
								ownerLogin,
								name: repoName,
								number: pr.number,
								mergeMethod:
									typeof payload.mergeMethod === "string"
										? payload.mergeMethod
										: null,
								commitTitle:
									typeof payload.commitTitle === "string"
										? payload.commitTitle
										: null,
								commitMessage:
									typeof payload.commitMessage === "string"
										? payload.commitMessage
										: null,
							}
						: operationType === "update_pull_request_branch"
							? {
									ownerLogin,
									name: repoName,
									number: pr.number,
									expectedHeadSha,
								}
							: operationType === "update_issue_state"
								? {
										ownerLogin,
										name: repoName,
										number: pr.number,
										state: pr.state,
									}
								: operationType === "update_labels"
									? {
											ownerLogin,
											name: repoName,
											number: pr.number,
											labelsToAdd,
											labelsToRemove,
										}
									: {
											ownerLogin,
											name: repoName,
											number: pr.number,
											assigneesToAdd,
											assigneesToRemove,
										};

				return {
					_id: String(pr._id),
					_creationTime: pr._creationTime,
					correlationId,
					operationType,
					state: optimisticState,
					repositoryId: pr.repositoryId,
					ownerLogin,
					repoName,
					inputPayloadJson: JSON.stringify(inputPayload),
					optimisticDataJson: JSON.stringify({
						number: pr.number,
						state: pr.state,
						labelNames: [...(pr.labelNames ?? [])],
						assigneeUserIds: [...pr.assigneeUserIds],
					}),
					resultDataJson:
						operationType === "merge_pull_request"
							? JSON.stringify({
									merged: pr.mergedAt !== null,
									number: pr.number,
								})
							: operationType === "update_pull_request_branch"
								? JSON.stringify({
										number: pr.number,
										headSha: pr.headSha,
									})
								: operationType === "update_issue_state"
									? JSON.stringify({ number: pr.number, state: pr.state })
									: operationType === "update_labels"
										? JSON.stringify({
												number: pr.number,
												labelNames: [...(pr.labelNames ?? [])],
											})
										: JSON.stringify({
												number: pr.number,
												assigneeUserIds: [...pr.assigneeUserIds],
											}),
					errorMessage: pr.optimisticErrorMessage ?? null,
					errorStatus: pr.optimisticErrorStatus ?? null,
					githubEntityNumber: pr.number,
					createdAt: pr._creationTime,
					updatedAt: pr.optimisticUpdatedAt ?? pr.githubUpdatedAt,
				};
			})
			.filter((op) => op !== null)
			.filter((op) =>
				args.stateFilter === undefined ? true : op.state === args.stateFilter,
			);

		const reviewRows = yield* ctx.db
			.query("github_pull_request_reviews")
			.withIndex("by_repositoryId_and_pullRequestNumber", (q) =>
				q.eq("repositoryId", repositoryId),
			)
			.take(200);

		const reviewOps = reviewRows
			.map((review) => {
				const correlationId = review.optimisticCorrelationId;
				const optimisticState = review.optimisticState;
				if (correlationId === null || correlationId === undefined) return null;
				if (review.optimisticOperationType !== "submit_pr_review") return null;
				if (
					optimisticState !== "pending" &&
					optimisticState !== "failed" &&
					optimisticState !== "confirmed"
				) {
					return null;
				}

				const payload = parseJsonObject(review.optimisticPayloadJson);
				const event =
					payload.event === "APPROVE" ||
					payload.event === "REQUEST_CHANGES" ||
					payload.event === "COMMENT"
						? payload.event
						: "COMMENT";
				const body = typeof payload.body === "string" ? payload.body : null;

				return {
					_id: String(review._id),
					_creationTime: review._creationTime,
					correlationId,
					operationType: "submit_pr_review",
					state: optimisticState,
					repositoryId: review.repositoryId,
					ownerLogin,
					repoName,
					inputPayloadJson: JSON.stringify({
						ownerLogin,
						name: repoName,
						number: review.pullRequestNumber,
						event,
						body,
					}),
					optimisticDataJson: JSON.stringify({
						pullRequestNumber: review.pullRequestNumber,
						state: review.state,
						event,
						body,
					}),
					resultDataJson:
						review.githubReviewId > 0
							? JSON.stringify({ reviewId: review.githubReviewId })
							: null,
					errorMessage: review.optimisticErrorMessage ?? null,
					errorStatus: review.optimisticErrorStatus ?? null,
					githubEntityNumber:
						review.pullRequestNumber > 0 ? review.pullRequestNumber : null,
					createdAt: review._creationTime,
					updatedAt:
						review.optimisticUpdatedAt ??
						review.submittedAt ??
						review._creationTime,
				};
			})
			.filter((op) => op !== null)
			.filter((op) =>
				args.stateFilter === undefined ? true : op.state === args.stateFilter,
			);

		const decodeWriteOperation = Schema.decodeUnknownSync(WriteOperation);
		return [...issueOps, ...commentOps, ...prOps, ...reviewOps]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, 50)
			.map((op) => decodeWriteOperation(op));
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const githubWriteModule = makeRpcModule(
	{
		// Public mutations (optimistic write entry points)
		createIssue: createIssueDef,
		createComment: createCommentDef,
		updateIssueState: updateIssueStateDef,
		mergePullRequest: mergePullRequestDef,
		updatePullRequestBranch: updatePullRequestBranchDef,
		submitPrReview: submitPrReviewDef,
		updateLabels: updateLabelsDef,
		updateAssignees: updateAssigneesDef,
		// Internal action (executes the GitHub API call)
		executeWriteOperation: executeWriteOperationDef,
		// Internal mutations (state transitions)
		markIssueCreateAccepted: markIssueCreateAcceptedDef,
		markIssueCreateFailed: markIssueCreateFailedDef,
		markCommentCreateAccepted: markCommentCreateAcceptedDef,
		markCommentCreateFailed: markCommentCreateFailedDef,
		markIssueStateUpdateAccepted: markIssueStateUpdateAcceptedDef,
		markIssueStateUpdateFailed: markIssueStateUpdateFailedDef,
		markMergePullRequestAccepted: markMergePullRequestAcceptedDef,
		markMergePullRequestFailed: markMergePullRequestFailedDef,
		markPullRequestBranchUpdateAccepted: markPullRequestBranchUpdateAcceptedDef,
		markPullRequestBranchUpdateFailed: markPullRequestBranchUpdateFailedDef,
		markPrReviewAccepted: markPrReviewAcceptedDef,
		markPrReviewFailed: markPrReviewFailedDef,
		markLabelsUpdateAccepted: markLabelsUpdateAcceptedDef,
		markLabelsUpdateFailed: markLabelsUpdateFailedDef,
		markAssigneesUpdateAccepted: markAssigneesUpdateAcceptedDef,
		markAssigneesUpdateFailed: markAssigneesUpdateFailedDef,
		// Internal query (used by action)
		getPendingIssueCreate: getPendingIssueCreateDef,
		getPendingCommentCreate: getPendingCommentCreateDef,
		getPendingIssueStateUpdate: getPendingIssueStateUpdateDef,
		getPendingPullRequestMerge: getPendingPullRequestMergeDef,
		getPendingPullRequestBranchUpdate: getPendingPullRequestBranchUpdateDef,
		getPendingPrReview: getPendingPrReviewDef,
		getPendingLabelsUpdate: getPendingLabelsUpdateDef,
		getPendingAssigneesUpdate: getPendingAssigneesUpdateDef,
		// Public query (UI consumption)
		listWriteOperations: listWriteOperationsDef,
	},
	{ middlewares: DatabaseRpcModuleMiddlewares },
);

export const {
	createIssue,
	createComment,
	updateIssueState,
	mergePullRequest,
	updatePullRequestBranch,
	submitPrReview,
	updateLabels,
	updateAssignees,
	executeWriteOperation,
	markIssueCreateAccepted,
	markIssueCreateFailed,
	markCommentCreateAccepted,
	markCommentCreateFailed,
	markIssueStateUpdateAccepted,
	markIssueStateUpdateFailed,
	markMergePullRequestAccepted,
	markMergePullRequestFailed,
	markPullRequestBranchUpdateAccepted,
	markPullRequestBranchUpdateFailed,
	markPrReviewAccepted,
	markPrReviewFailed,
	markLabelsUpdateAccepted,
	markLabelsUpdateFailed,
	markAssigneesUpdateAccepted,
	markAssigneesUpdateFailed,
	getPendingIssueCreate,
	getPendingCommentCreate,
	getPendingIssueStateUpdate,
	getPendingPullRequestMerge,
	getPendingPullRequestBranchUpdate,
	getPendingPrReview,
	getPendingLabelsUpdate,
	getPendingAssigneesUpdate,
	listWriteOperations,
} = githubWriteModule.handlers;
export {
	githubWriteModule,
	GitHubWriteError,
	DuplicateOperationError,
	NotAuthenticated,
	InsufficientPermission,
};
export type GithubWriteModule = typeof githubWriteModule;
