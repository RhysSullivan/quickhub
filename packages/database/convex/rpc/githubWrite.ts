/**
 * GitHub write workflows with optimistic updates.
 *
 * Pattern:
 *   1. Public MUTATION inserts a `github_write_operations` row in state "pending"
 *      with optimistic data, then schedules an internal action.
 *   2. Internal ACTION calls GitHub API, then calls an internal mutation to mark
 *      the operation "completed" (with response data) or "failed" (with error).
 *   3. When the webhook arrives, webhookProcessor reconciles the operation to
 *      "confirmed" — proving the write landed.
 *
 * The UI subscribes to the write operations table and can show optimistic state
 * immediately, then converge to the confirmed state.
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
import { GitHubApiClient } from "../shared/githubApi";
import { lookupGitHubTokenByUserIdConfect } from "../shared/githubToken";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

const OperationType = Schema.Literal(
	"create_issue",
	"create_comment",
	"update_issue_state",
	"merge_pull_request",
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

// ---------------------------------------------------------------------------
// 1. Public mutations — create pending write ops + schedule actions
// ---------------------------------------------------------------------------

/**
 * Create a new issue (optimistic).
 * Inserts a pending write operation and schedules the GitHub API call.
 */
const createIssueDef = factory.mutation({
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
	error: DuplicateOperationError,
});

createIssueDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();

		// Dedup check
		const existing = yield* ctx.db
			.query("github_write_operations")
			.withIndex("by_correlationId", (q) =>
				q.eq("correlationId", args.correlationId),
			)
			.first();

		if (Option.isSome(existing)) {
			return yield* new DuplicateOperationError({
				correlationId: args.correlationId,
			});
		}

		const inputPayload = {
			ownerLogin: args.ownerLogin,
			name: args.name,
			title: args.title,
			body: args.body,
			labels: args.labels,
		};

		const optimisticData = {
			title: args.title,
			body: args.body ?? null,
			labels: args.labels ?? [],
		};

		yield* ctx.db.insert("github_write_operations", {
			correlationId: args.correlationId,
			operationType: "create_issue",
			state: "pending",
			repositoryId: args.repositoryId,
			ownerLogin: args.ownerLogin,
			repoName: args.name,
			inputPayloadJson: JSON.stringify(inputPayload),
			optimisticDataJson: JSON.stringify(optimisticData),
			resultDataJson: null,
			errorMessage: null,
			errorStatus: null,
			githubEntityNumber: null,
			createdAt: now,
			updatedAt: now,
		});

		yield* Effect.promise(() =>
			ctx.scheduler.runAfter(
				0,
				internal.rpc.githubWrite.executeWriteOperation,
				{ correlationId: args.correlationId },
			),
		);

		return { correlationId: args.correlationId };
	}),
);

/**
 * Create a comment on an issue or PR (optimistic).
 */
const createCommentDef = factory.mutation({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		number: Schema.Number,
		body: Schema.String,
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: DuplicateOperationError,
});

createCommentDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();

		const existing = yield* ctx.db
			.query("github_write_operations")
			.withIndex("by_correlationId", (q) =>
				q.eq("correlationId", args.correlationId),
			)
			.first();

		if (Option.isSome(existing)) {
			return yield* new DuplicateOperationError({
				correlationId: args.correlationId,
			});
		}

		const inputPayload = {
			ownerLogin: args.ownerLogin,
			name: args.name,
			number: args.number,
			body: args.body,
		};

		const optimisticData = {
			number: args.number,
			body: args.body,
		};

		yield* ctx.db.insert("github_write_operations", {
			correlationId: args.correlationId,
			operationType: "create_comment",
			state: "pending",
			repositoryId: args.repositoryId,
			ownerLogin: args.ownerLogin,
			repoName: args.name,
			inputPayloadJson: JSON.stringify(inputPayload),
			optimisticDataJson: JSON.stringify(optimisticData),
			resultDataJson: null,
			errorMessage: null,
			errorStatus: null,
			githubEntityNumber: args.number,
			createdAt: now,
			updatedAt: now,
		});

		yield* Effect.promise(() =>
			ctx.scheduler.runAfter(
				0,
				internal.rpc.githubWrite.executeWriteOperation,
				{ correlationId: args.correlationId },
			),
		);

		return { correlationId: args.correlationId };
	}),
);

/**
 * Update issue/PR state (optimistic).
 */
const updateIssueStateDef = factory.mutation({
	payload: {
		correlationId: Schema.String,
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		number: Schema.Number,
		state: Schema.Literal("open", "closed"),
	},
	success: Schema.Struct({ correlationId: Schema.String }),
	error: DuplicateOperationError,
});

updateIssueStateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();

		const existing = yield* ctx.db
			.query("github_write_operations")
			.withIndex("by_correlationId", (q) =>
				q.eq("correlationId", args.correlationId),
			)
			.first();

		if (Option.isSome(existing)) {
			return yield* new DuplicateOperationError({
				correlationId: args.correlationId,
			});
		}

		const inputPayload = {
			ownerLogin: args.ownerLogin,
			name: args.name,
			number: args.number,
			state: args.state,
		};

		const optimisticData = {
			number: args.number,
			state: args.state,
		};

		yield* ctx.db.insert("github_write_operations", {
			correlationId: args.correlationId,
			operationType: "update_issue_state",
			state: "pending",
			repositoryId: args.repositoryId,
			ownerLogin: args.ownerLogin,
			repoName: args.name,
			inputPayloadJson: JSON.stringify(inputPayload),
			optimisticDataJson: JSON.stringify(optimisticData),
			resultDataJson: null,
			errorMessage: null,
			errorStatus: null,
			githubEntityNumber: args.number,
			createdAt: now,
			updatedAt: now,
		});

		yield* Effect.promise(() =>
			ctx.scheduler.runAfter(
				0,
				internal.rpc.githubWrite.executeWriteOperation,
				{ correlationId: args.correlationId },
			),
		);

		return { correlationId: args.correlationId };
	}),
);

/**
 * Merge a pull request (optimistic).
 */
const mergePullRequestDef = factory.mutation({
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
	error: DuplicateOperationError,
});

mergePullRequestDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();

		const existing = yield* ctx.db
			.query("github_write_operations")
			.withIndex("by_correlationId", (q) =>
				q.eq("correlationId", args.correlationId),
			)
			.first();

		if (Option.isSome(existing)) {
			return yield* new DuplicateOperationError({
				correlationId: args.correlationId,
			});
		}

		const inputPayload = {
			ownerLogin: args.ownerLogin,
			name: args.name,
			number: args.number,
			mergeMethod: args.mergeMethod,
			commitTitle: args.commitTitle,
			commitMessage: args.commitMessage,
		};

		const optimisticData = {
			number: args.number,
			mergeMethod: args.mergeMethod ?? "merge",
		};

		yield* ctx.db.insert("github_write_operations", {
			correlationId: args.correlationId,
			operationType: "merge_pull_request",
			state: "pending",
			repositoryId: args.repositoryId,
			ownerLogin: args.ownerLogin,
			repoName: args.name,
			inputPayloadJson: JSON.stringify(inputPayload),
			optimisticDataJson: JSON.stringify(optimisticData),
			resultDataJson: null,
			errorMessage: null,
			errorStatus: null,
			githubEntityNumber: args.number,
			createdAt: now,
			updatedAt: now,
		});

		yield* Effect.promise(() =>
			ctx.scheduler.runAfter(
				0,
				internal.rpc.githubWrite.executeWriteOperation,
				{ correlationId: args.correlationId },
			),
		);

		return { correlationId: args.correlationId };
	}),
);

// ---------------------------------------------------------------------------
// 2. Internal action — execute the GitHub API call
// ---------------------------------------------------------------------------

/**
 * Execute a pending write operation by calling the GitHub API.
 * On success, calls markWriteCompleted. On failure, calls markWriteFailed.
 */
const executeWriteOperationDef = factory.internalAction({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({ completed: Schema.Boolean }),
});

executeWriteOperationDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		// Read the operation via internal query
		// Confect's makeActionCtx now auto-unwraps ExitEncoded, giving us the value directly
		const opResult = yield* ctx.runQuery(
			internal.rpc.githubWrite.getWriteOperation,
			{ correlationId: args.correlationId },
		);

		// Decode through Schema for type safety (FunctionReturnType is unknown due to Convex codegen)
		const OpResultSchema = Schema.Struct({
			found: Schema.Boolean,
			operationType: Schema.optional(Schema.String),
			inputPayloadJson: Schema.optional(Schema.String),
			ownerLogin: Schema.optional(Schema.String),
			repoName: Schema.optional(Schema.String),
			connectedByUserId: Schema.optional(Schema.NullOr(Schema.String)),
		});
		const op = Schema.decodeUnknownSync(OpResultSchema)(opResult);
		if (!op.found) {
			return { completed: false };
		}
		const inputPayload = JSON.parse(op.inputPayloadJson ?? "{}") as Record<
			string,
			unknown
		>;
		const operationType = op.operationType ?? "";
		const ownerLogin = op.ownerLogin ?? "";
		const repoName = op.repoName ?? "";

		// Resolve the GitHub token from the repo's connected user
		const connectedByUserId = op.connectedByUserId ?? null;
		if (!connectedByUserId) {
			return { completed: false };
		}
		const token = yield* lookupGitHubTokenByUserIdConfect(
			ctx.runQuery,
			connectedByUserId,
		);
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		// Dispatch based on operation type
		const result = yield* Effect.gen(function* () {
			if (operationType === "create_issue") {
				return yield* executeCreateIssue(
					gh,
					ownerLogin,
					repoName,
					inputPayload,
				);
			}
			if (operationType === "create_comment") {
				return yield* executeCreateComment(
					gh,
					ownerLogin,
					repoName,
					inputPayload,
				);
			}
			if (operationType === "update_issue_state") {
				return yield* executeUpdateIssueState(
					gh,
					ownerLogin,
					repoName,
					inputPayload,
				);
			}
			if (operationType === "merge_pull_request") {
				return yield* executeMergePullRequest(
					gh,
					ownerLogin,
					repoName,
					inputPayload,
				);
			}
			return {
				success: false,
				resultData: null,
				entityNumber: null,
				errorStatus: 0,
				errorMessage: `Unknown operation type: ${operationType}`,
			};
		}).pipe(
			Effect.catchAll((error) =>
				Effect.succeed({
					success: false,
					resultData: null,
					entityNumber: null,
					errorStatus: 0,
					errorMessage: String(error),
				}),
			),
		);

		// Call internal mutation to mark completed or failed
		if (result.success) {
			yield* ctx.runMutation(internal.rpc.githubWrite.markWriteCompleted, {
				correlationId: args.correlationId,
				resultDataJson: result.resultData
					? JSON.stringify(result.resultData)
					: null,
				githubEntityNumber: result.entityNumber,
			});
		} else {
			yield* ctx.runMutation(internal.rpc.githubWrite.markWriteFailed, {
				correlationId: args.correlationId,
				errorMessage: result.errorMessage ?? "Unknown error",
				errorStatus: result.errorStatus ?? 0,
			});
		}

		return { completed: result.success };
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
	use: <A>(
		fn: (
			fetch: (path: string, init?: RequestInit) => Promise<Response>,
		) => Promise<A>,
	) => Effect.Effect<
		A,
		| import("../shared/githubApi").GitHubApiError
		| import("../shared/githubApi").GitHubRateLimitError
	>;
};

const executeCreateIssue = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const result = yield* gh.use(async (fetch) => {
			const body: Record<string, unknown> = { title: input.title };
			if (input.body !== undefined) body.body = input.body;
			if (Array.isArray(input.labels) && input.labels.length > 0) {
				body.labels = input.labels;
			}

			const res = await fetch(`/repos/${ownerLogin}/${repoName}/issues`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (!res.ok) {
				const text = await res.text();
				return { ok: false, status: res.status, message: text, data: null };
			}

			const data = await res.json();
			return { ok: true, status: res.status, message: null, data };
		});

		if (!result.ok) {
			return {
				success: false,
				resultData: null,
				entityNumber: null,
				errorStatus: result.status,
				errorMessage: result.message,
			};
		}

		return {
			success: true,
			resultData: {
				number: num(result.data?.number) ?? 0,
				htmlUrl: str(result.data?.html_url) ?? "",
			},
			entityNumber: num(result.data?.number),
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchTags({
			GitHubApiError: (e) =>
				Effect.succeed({
					success: false,
					resultData: null,
					entityNumber: null,
					errorStatus: e.status,
					errorMessage: e.message,
				} satisfies ExecutionResult),
			GitHubRateLimitError: (e) =>
				Effect.succeed({
					success: false,
					resultData: null,
					entityNumber: null,
					errorStatus: e.status,
					errorMessage: e.message,
				} satisfies ExecutionResult),
		}),
	);

const executeCreateComment = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const issueNumber = num(input.number) ?? 0;
		const result = yield* gh.use(async (fetch) => {
			const res = await fetch(
				`/repos/${ownerLogin}/${repoName}/issues/${issueNumber}/comments`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ body: input.body }),
				},
			);

			if (!res.ok) {
				const text = await res.text();
				return { ok: false, status: res.status, message: text, data: null };
			}

			const data = await res.json();
			return { ok: true, status: res.status, message: null, data };
		});

		if (!result.ok) {
			return {
				success: false,
				resultData: null,
				entityNumber: null,
				errorStatus: result.status,
				errorMessage: result.message,
			};
		}

		return {
			success: true,
			resultData: {
				commentId: num(result.data?.id) ?? 0,
				htmlUrl: str(result.data?.html_url) ?? "",
			},
			entityNumber: issueNumber,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchTags({
			GitHubApiError: (e) =>
				Effect.succeed({
					success: false,
					resultData: null,
					entityNumber: null,
					errorStatus: e.status,
					errorMessage: e.message,
				} satisfies ExecutionResult),
			GitHubRateLimitError: (e) =>
				Effect.succeed({
					success: false,
					resultData: null,
					entityNumber: null,
					errorStatus: e.status,
					errorMessage: e.message,
				} satisfies ExecutionResult),
		}),
	);

const executeUpdateIssueState = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const issueNumber = num(input.number) ?? 0;
		const result = yield* gh.use(async (fetch) => {
			const res = await fetch(
				`/repos/${ownerLogin}/${repoName}/issues/${issueNumber}`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ state: input.state }),
				},
			);

			if (!res.ok) {
				const text = await res.text();
				return { ok: false, status: res.status, message: text, data: null };
			}

			const data = await res.json();
			return { ok: true, status: res.status, message: null, data };
		});

		if (!result.ok) {
			return {
				success: false,
				resultData: null,
				entityNumber: null,
				errorStatus: result.status,
				errorMessage: result.message,
			};
		}

		const returnedState = str(result.data?.state);
		return {
			success: true,
			resultData: {
				number: num(result.data?.number) ?? issueNumber,
				state: returnedState === "open" ? "open" : "closed",
			},
			entityNumber: issueNumber,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchTags({
			GitHubApiError: (e) =>
				Effect.succeed({
					success: false,
					resultData: null,
					entityNumber: null,
					errorStatus: e.status,
					errorMessage: e.message,
				} satisfies ExecutionResult),
			GitHubRateLimitError: (e) =>
				Effect.succeed({
					success: false,
					resultData: null,
					entityNumber: null,
					errorStatus: e.status,
					errorMessage: e.message,
				} satisfies ExecutionResult),
		}),
	);

const executeMergePullRequest = (
	gh: GHClient,
	ownerLogin: string,
	repoName: string,
	input: Record<string, unknown>,
): Effect.Effect<ExecutionResult> =>
	Effect.gen(function* () {
		const prNumber = num(input.number) ?? 0;
		const result = yield* gh.use(async (fetch) => {
			const body: Record<string, unknown> = {};
			if (input.mergeMethod !== undefined)
				body.merge_method = input.mergeMethod;
			if (input.commitTitle !== undefined)
				body.commit_title = input.commitTitle;
			if (input.commitMessage !== undefined)
				body.commit_message = input.commitMessage;

			const res = await fetch(
				`/repos/${ownerLogin}/${repoName}/pulls/${prNumber}/merge`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				},
			);

			if (!res.ok) {
				const text = await res.text();
				return { ok: false, status: res.status, message: text, data: null };
			}

			const data = await res.json();
			return { ok: true, status: res.status, message: null, data };
		});

		if (!result.ok) {
			return {
				success: false,
				resultData: null,
				entityNumber: null,
				errorStatus: result.status,
				errorMessage: result.message,
			};
		}

		return {
			success: true,
			resultData: {
				merged: result.data?.merged === true,
				sha: str(result.data?.sha) ?? "",
				message: str(result.data?.message) ?? "Pull request merged",
			},
			entityNumber: prNumber,
			errorStatus: 0,
			errorMessage: null,
		};
	}).pipe(
		Effect.catchTags({
			GitHubApiError: (e) =>
				Effect.succeed({
					success: false,
					resultData: null,
					entityNumber: null,
					errorStatus: e.status,
					errorMessage: e.message,
				} satisfies ExecutionResult),
			GitHubRateLimitError: (e) =>
				Effect.succeed({
					success: false,
					resultData: null,
					entityNumber: null,
					errorStatus: e.status,
					errorMessage: e.message,
				} satisfies ExecutionResult),
		}),
	);

// ---------------------------------------------------------------------------
// 3. Internal mutations — mark completed / failed / confirmed
// ---------------------------------------------------------------------------

const markWriteCompletedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		resultDataJson: Schema.NullOr(Schema.String),
		githubEntityNumber: Schema.NullOr(Schema.Number),
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markWriteCompletedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const op = yield* ctx.db
			.query("github_write_operations")
			.withIndex("by_correlationId", (q) =>
				q.eq("correlationId", args.correlationId),
			)
			.first();

		if (Option.isNone(op)) return { updated: false };
		if (op.value.state !== "pending") return { updated: false };

		yield* ctx.db.patch(op.value._id, {
			state: "completed",
			resultDataJson: args.resultDataJson,
			githubEntityNumber: args.githubEntityNumber,
			updatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

const markWriteFailedDef = factory.internalMutation({
	payload: {
		correlationId: Schema.String,
		errorMessage: Schema.String,
		errorStatus: Schema.Number,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

markWriteFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const op = yield* ctx.db
			.query("github_write_operations")
			.withIndex("by_correlationId", (q) =>
				q.eq("correlationId", args.correlationId),
			)
			.first();

		if (Option.isNone(op)) return { updated: false };
		if (op.value.state !== "pending") return { updated: false };

		yield* ctx.db.patch(op.value._id, {
			state: "failed",
			errorMessage: args.errorMessage,
			errorStatus: args.errorStatus,
			updatedAt: Date.now(),
		});

		return { updated: true };
	}),
);

/**
 * Confirm a write operation when the webhook arrives.
 * Called from webhookProcessor when it detects a matching write op.
 */
const confirmWriteOperationDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		operationType: OperationType,
		githubEntityNumber: Schema.Number,
	},
	success: Schema.Struct({ confirmed: Schema.Boolean }),
});

confirmWriteOperationDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		// Find the most recent pending or completed operation matching this entity
		const ops = yield* ctx.db
			.query("github_write_operations")
			.withIndex(
				"by_repositoryId_and_operationType_and_githubEntityNumber",
				(q) =>
					q
						.eq("repositoryId", args.repositoryId)
						.eq("operationType", args.operationType)
						.eq("githubEntityNumber", args.githubEntityNumber),
			)
			.order("desc")
			.take(5);

		let confirmed = false;
		for (const op of ops) {
			if (op.state === "pending" || op.state === "completed") {
				yield* ctx.db.patch(op._id, {
					state: "confirmed",
					updatedAt: Date.now(),
				});
				confirmed = true;
				break;
			}
		}

		return { confirmed };
	}),
);

// ---------------------------------------------------------------------------
// 4. Internal query — read operation (used by the action)
// ---------------------------------------------------------------------------

const getWriteOperationDef = factory.internalQuery({
	payload: { correlationId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		operationType: Schema.optional(Schema.String),
		inputPayloadJson: Schema.optional(Schema.String),
		ownerLogin: Schema.optional(Schema.String),
		repoName: Schema.optional(Schema.String),
		connectedByUserId: Schema.optional(Schema.NullOr(Schema.String)),
	}),
});

getWriteOperationDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const op = yield* ctx.db
			.query("github_write_operations")
			.withIndex("by_correlationId", (q) =>
				q.eq("correlationId", args.correlationId),
			)
			.first();

		if (Option.isNone(op)) return { found: false };

		// Look up the repo's connectedByUserId
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", op.value.ownerLogin).eq("name", op.value.repoName),
			)
			.first();

		return {
			found: true,
			operationType: op.value.operationType,
			inputPayloadJson: op.value.inputPayloadJson,
			ownerLogin: op.value.ownerLogin,
			repoName: op.value.repoName,
			connectedByUserId: Option.isSome(repo)
				? repo.value.connectedByUserId
				: null,
		};
	}),
);

// ---------------------------------------------------------------------------
// 5. Public query — list write operations for a repo
// ---------------------------------------------------------------------------

const listWriteOperationsDef = factory.query({
	payload: {
		repositoryId: Schema.Number,
		/** Optionally filter by state */
		stateFilter: Schema.optional(OperationState),
	},
	success: Schema.Array(WriteOperation),
});

listWriteOperationsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		if (args.stateFilter !== undefined) {
			const ops = yield* ctx.db
				.query("github_write_operations")
				.withIndex("by_repositoryId_and_state_and_createdAt", (q) =>
					q
						.eq("repositoryId", args.repositoryId)
						.eq("state", args.stateFilter!),
				)
				.order("desc")
				.take(50);

			return ops.map((op) => ({
				_id: String(op._id),
				_creationTime: op._creationTime,
				correlationId: op.correlationId,
				operationType: op.operationType,
				state: op.state,
				repositoryId: op.repositoryId,
				ownerLogin: op.ownerLogin,
				repoName: op.repoName,
				inputPayloadJson: op.inputPayloadJson,
				optimisticDataJson: op.optimisticDataJson,
				resultDataJson: op.resultDataJson,
				errorMessage: op.errorMessage,
				errorStatus: op.errorStatus,
				githubEntityNumber: op.githubEntityNumber,
				createdAt: op.createdAt,
				updatedAt: op.updatedAt,
			}));
		}

		// No state filter — get recent ops across all states
		const ops = yield* ctx.db
			.query("github_write_operations")
			.withIndex("by_repositoryId_and_state_and_createdAt", (q) =>
				q.eq("repositoryId", args.repositoryId),
			)
			.order("desc")
			.take(50);

		return ops.map((op) => ({
			_id: String(op._id),
			_creationTime: op._creationTime,
			correlationId: op.correlationId,
			operationType: op.operationType,
			state: op.state,
			repositoryId: op.repositoryId,
			ownerLogin: op.ownerLogin,
			repoName: op.repoName,
			inputPayloadJson: op.inputPayloadJson,
			optimisticDataJson: op.optimisticDataJson,
			resultDataJson: op.resultDataJson,
			errorMessage: op.errorMessage,
			errorStatus: op.errorStatus,
			githubEntityNumber: op.githubEntityNumber,
			createdAt: op.createdAt,
			updatedAt: op.updatedAt,
		}));
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
		// Internal action (executes the GitHub API call)
		executeWriteOperation: executeWriteOperationDef,
		// Internal mutations (state transitions)
		markWriteCompleted: markWriteCompletedDef,
		markWriteFailed: markWriteFailedDef,
		confirmWriteOperation: confirmWriteOperationDef,
		// Internal query (used by action)
		getWriteOperation: getWriteOperationDef,
		// Public query (UI consumption)
		listWriteOperations: listWriteOperationsDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const {
	createIssue,
	createComment,
	updateIssueState,
	mergePullRequest,
	executeWriteOperation,
	markWriteCompleted,
	markWriteFailed,
	confirmWriteOperation,
	getWriteOperation,
	listWriteOperations,
} = githubWriteModule.handlers;
export { githubWriteModule, GitHubWriteError, DuplicateOperationError };
export type GithubWriteModule = typeof githubWriteModule;
