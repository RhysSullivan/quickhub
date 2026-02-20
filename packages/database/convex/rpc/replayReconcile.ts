/**
 * Replay, reconcile, and dead-letter operations.
 *
 * - replayEvent: re-process a single webhook event (reset to pending, re-run)
 * - retryAllFailed: batch re-process all failed events
 * - moveToDeadLetter: move a failed event to the dead_letters table
 * - listFailedEvents: query failed events for inspection
 * - reconcileRepo: schedule a full re-bootstrap for a connected repo
 */
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { internal } from "../_generated/api";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/**
 * Re-process a single webhook event by deliveryId.
 * Resets processState to "pending" and runs the processor inline.
 */
const replayEventDef = factory.mutation({
	payload: { deliveryId: Schema.String },
	success: Schema.Struct({
		found: Schema.Boolean,
		previousState: Schema.NullOr(Schema.String),
	}),
});

/**
 * Batch retry all failed events (up to limit).
 * Resets their state to "pending" so the next processAllPending call picks them up.
 */
const retryAllFailedDef = factory.mutation({
	payload: { limit: Schema.optional(Schema.Number) },
	success: Schema.Struct({ resetCount: Schema.Number }),
});

/**
 * Move a failed event to the dead_letters table and remove from raw events.
 */
const moveToDeadLetterDef = factory.mutation({
	payload: {
		deliveryId: Schema.String,
		reason: Schema.String,
	},
	success: Schema.Struct({ moved: Schema.Boolean }),
});

/**
 * List failed webhook events for inspection.
 */
const listFailedEventsDef = factory.query({
	payload: { limit: Schema.optional(Schema.Number) },
	success: Schema.Array(
		Schema.Struct({
			deliveryId: Schema.String,
			eventName: Schema.String,
			action: Schema.NullOr(Schema.String),
			repositoryId: Schema.NullOr(Schema.Number),
			processError: Schema.NullOr(Schema.String),
			receivedAt: Schema.Number,
		}),
	),
});

/**
 * List dead-lettered events.
 */
const listDeadLettersDef = factory.query({
	payload: { limit: Schema.optional(Schema.Number) },
	success: Schema.Array(
		Schema.Struct({
			deliveryId: Schema.String,
			reason: Schema.String,
			createdAt: Schema.Number,
		}),
	),
});

/**
 * Trigger a full re-bootstrap for an already-connected repo.
 * Creates a new sync job and schedules the bootstrap action.
 */
const reconcileRepoDef = factory.mutation({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
	},
	success: Schema.Struct({
		scheduled: Schema.Boolean,
		lockKey: Schema.NullOr(Schema.String),
	}),
});

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

replayEventDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		const event = yield* ctx.db
			.query("github_webhook_events_raw")
			.withIndex("by_deliveryId", (q) => q.eq("deliveryId", args.deliveryId))
			.first();

		if (Option.isNone(event)) {
			return { found: false, previousState: null };
		}

		const previousState = event.value.processState;

		// Reset to pending so it can be re-processed
		yield* ctx.db.patch(event.value._id, {
			processState: "pending",
			processError: null,
			processAttempts: 0,
			nextRetryAt: null,
		});

		return { found: true, previousState };
	}),
);

retryAllFailedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const limit = args.limit ?? 100;

		const failedEvents = yield* ctx.db
			.query("github_webhook_events_raw")
			.withIndex("by_processState_and_receivedAt", (q) =>
				q.eq("processState", "failed"),
			)
			.take(limit);

		for (const event of failedEvents) {
			yield* ctx.db.patch(event._id, {
				processState: "pending",
				processError: null,
				processAttempts: 0,
				nextRetryAt: null,
			});
		}

		return { resetCount: failedEvents.length };
	}),
);

moveToDeadLetterDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		const event = yield* ctx.db
			.query("github_webhook_events_raw")
			.withIndex("by_deliveryId", (q) => q.eq("deliveryId", args.deliveryId))
			.first();

		if (Option.isNone(event)) {
			return { moved: false };
		}

		// Insert into dead_letters
		yield* ctx.db.insert("github_dead_letters", {
			deliveryId: event.value.deliveryId,
			reason: args.reason,
			payloadJson: event.value.payloadJson,
			createdAt: Date.now(),
		});

		// Delete from raw events
		yield* ctx.db.delete(event.value._id);

		return { moved: true };
	}),
);

listFailedEventsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const limit = args.limit ?? 50;

		const failedEvents = yield* ctx.db
			.query("github_webhook_events_raw")
			.withIndex("by_processState_and_receivedAt", (q) =>
				q.eq("processState", "failed"),
			)
			.order("desc")
			.take(limit);

		return failedEvents.map((e) => ({
			deliveryId: e.deliveryId,
			eventName: e.eventName,
			action: e.action,
			repositoryId: e.repositoryId,
			processError: e.processError,
			receivedAt: e.receivedAt,
		}));
	}),
);

listDeadLettersDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const limit = args.limit ?? 50;

		const letters = yield* ctx.db
			.query("github_dead_letters")
			.withIndex("by_createdAt")
			.order("desc")
			.take(limit);

		return letters.map((l) => ({
			deliveryId: l.deliveryId,
			reason: l.reason,
			createdAt: l.createdAt,
		}));
	}),
);

reconcileRepoDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		// Find the repo
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repo)) {
			return { scheduled: false, lockKey: null };
		}

		const repoDoc = repo.value;
		const lockKey = `repo-reconcile:0:${repoDoc.githubRepoId}`;

		// Check for existing running/pending reconcile job
		const existingJob = yield* ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", lockKey))
			.first();

		if (
			Option.isSome(existingJob) &&
			(existingJob.value.state === "pending" ||
				existingJob.value.state === "running")
		) {
			return { scheduled: false, lockKey };
		}

		// Requires a connected user whose GitHub token can be used for API calls.
		const connectedByUserId = repoDoc.connectedByUserId;
		if (!connectedByUserId) {
			return { scheduled: false, lockKey: null };
		}

		const now = Date.now();

		// Create a reconcile sync job
		yield* ctx.db.insert("github_sync_jobs", {
			jobType: "reconcile",
			scopeType: "repository",
			triggerReason: "reconcile",
			lockKey,
			installationId: repoDoc.installationId,
			repositoryId: repoDoc.githubRepoId,
			entityType: null,
			state: "pending",
			attemptCount: 0,
			nextRunAt: now,
			lastError: null,
			createdAt: now,
			updatedAt: now,
		});

		// Start durable bootstrap workflow to re-fetch everything (idempotent upserts)
		yield* ctx.runMutation(internal.rpc.bootstrapWorkflow.startBootstrap, {
			repositoryId: repoDoc.githubRepoId,
			fullName: repoDoc.fullName,
			lockKey,
			connectedByUserId,
			installationId: repoDoc.installationId,
		});

		return { scheduled: true, lockKey };
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const replayReconcileModule = makeRpcModule(
	{
		replayEvent: replayEventDef,
		retryAllFailed: retryAllFailedDef,
		moveToDeadLetter: moveToDeadLetterDef,
		listFailedEvents: listFailedEventsDef,
		listDeadLetters: listDeadLettersDef,
		reconcileRepo: reconcileRepoDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const {
	replayEvent,
	retryAllFailed,
	moveToDeadLetter,
	listFailedEvents,
	listDeadLetters,
	reconcileRepo,
} = replayReconcileModule.handlers;
export { replayReconcileModule };
export type ReplayReconcileModule = typeof replayReconcileModule;
