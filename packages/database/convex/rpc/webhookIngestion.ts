import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { ConfectMutationCtx, confectSchema } from "../confect";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

/**
 * Internal mutation to store a raw GitHub webhook event.
 *
 * Called from the HTTP endpoint after signature verification.
 * Deduplicates by deliveryId — if a delivery already exists, skips insertion.
 */
const webhookIngestionModule = makeRpcModule(
	{
		storeRawEvent: factory.internalMutation(
			{
				payload: {
					deliveryId: Schema.String,
					eventName: Schema.String,
					action: Schema.NullOr(Schema.String),
					installationId: Schema.NullOr(Schema.Number),
					repositoryId: Schema.NullOr(Schema.Number),
					signatureValid: Schema.Boolean,
					payloadJson: Schema.String,
					receivedAt: Schema.Number,
				},
				success: Schema.Struct({
					stored: Schema.Boolean,
					deliveryId: Schema.String,
				}),
			},
			(args) =>
				Effect.gen(function* () {
					const ctx = yield* ConfectMutationCtx;

					// Deduplicate by deliveryId
					const existing = yield* ctx.db
						.query("github_webhook_events_raw")
						.withIndex("by_deliveryId", (q) =>
							q.eq("deliveryId", args.deliveryId),
						)
						.first();

					if (Option.isSome(existing)) {
						return { stored: false, deliveryId: args.deliveryId };
					}

					yield* ctx.db.insert("github_webhook_events_raw", {
						deliveryId: args.deliveryId,
						eventName: args.eventName,
						action: args.action,
						installationId: args.installationId,
						repositoryId: args.repositoryId,
						signatureValid: args.signatureValid,
						payloadJson: args.payloadJson,
						receivedAt: args.receivedAt,
						processState: "pending",
						processError: null,
					});

					return { stored: true, deliveryId: args.deliveryId };
				}),
		),
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const { storeRawEvent } = webhookIngestionModule.handlers;
export { webhookIngestionModule };
export type WebhookIngestionModule = typeof webhookIngestionModule;
