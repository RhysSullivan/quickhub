import { httpRouter } from "convex/server";
import { Effect, Schema } from "effect";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { verifyWebhookSignature } from "./shared/webhookVerify";

const http = httpRouter();

// ---------------------------------------------------------------------------
// Tagged errors for the webhook pipeline
// ---------------------------------------------------------------------------

class MissingHeaders extends Schema.TaggedError<MissingHeaders>()(
	"MissingHeaders",
	{ message: Schema.String },
) {}

class MissingSecret extends Schema.TaggedError<MissingSecret>()(
	"MissingSecret",
	{},
) {}

class InvalidPayload extends Schema.TaggedError<InvalidPayload>()(
	"InvalidPayload",
	{ message: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const jsonResponse = (body: Record<string, unknown>, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

/**
 * Safely extract a nested numeric `id` field from a payload object.
 * Returns `null` if the field doesn't exist or isn't a number.
 */
const extractNestedId = (
	payload: Record<string, unknown>,
	key: string,
): number | null => {
	const obj = payload[key];
	if (
		obj !== null &&
		obj !== undefined &&
		typeof obj === "object" &&
		"id" in obj
	) {
		// TypeScript narrows `obj` to `Record<"id", unknown>` via `in` check
		return typeof obj.id === "number" ? obj.id : null;
	}
	return null;
};

// ---------------------------------------------------------------------------
// Webhook handler — pure Effect pipeline
// ---------------------------------------------------------------------------

/**
 * GitHub webhook receiver.
 *
 * 1. Reads raw body + headers
 * 2. Verifies HMAC-SHA256 signature using GITHUB_WEBHOOK_SECRET
 * 3. Extracts event metadata (event type, action, delivery ID, repo/installation IDs)
 * 4. Stores raw event via internal mutation (deduped by deliveryId)
 * 5. Returns 200 immediately — processing happens async
 */
http.route({
	path: "/api/github/webhook",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const pipeline = Effect.gen(function* () {
			const body = yield* Effect.promise(() => request.text());
			const signatureHeader = request.headers.get("X-Hub-Signature-256");
			const eventName = request.headers.get("X-GitHub-Event");
			const deliveryId = request.headers.get("X-GitHub-Delivery");

			// 1. Validate required GitHub headers
			if (!eventName || !deliveryId) {
				return yield* new MissingHeaders({
					message: "Missing required GitHub webhook headers",
				});
			}

			// 2. Load webhook secret from environment
			const secret = process.env.GITHUB_WEBHOOK_SECRET;
			if (!secret) {
				return yield* new MissingSecret();
			}

			// 3. Verify HMAC-SHA256 signature
			yield* verifyWebhookSignature(signatureHeader, body, secret);

			// 4. Parse JSON payload
			const parsedPayload: Record<string, unknown> = yield* Effect.try({
				try: () => JSON.parse(body),
				catch: () =>
					new InvalidPayload({ message: "Request body is not valid JSON" }),
			});

			// 5. Extract metadata fields
			const action =
				typeof parsedPayload.action === "string" ? parsedPayload.action : null;
			const installationId = extractNestedId(parsedPayload, "installation");
			const repositoryId = extractNestedId(parsedPayload, "repository");

			// 6. Store raw event (internal mutation handles dedup by deliveryId)
			yield* Effect.promise(() =>
				ctx.runMutation(internal.rpc.webhookIngestion.storeRawEvent, {
					deliveryId,
					eventName,
					action,
					installationId,
					repositoryId,
					signatureValid: true,
					payloadJson: body,
					receivedAt: Date.now(),
				}),
			);

			return jsonResponse({ ok: true, deliveryId }, 200);
		});

		// Map each error type to an appropriate HTTP response
		const handled = pipeline.pipe(
			Effect.catchTags({
				MissingHeaders: (e) =>
					Effect.succeed(jsonResponse({ error: e.message }, 400)),
				MissingSecret: () => {
					console.error("GITHUB_WEBHOOK_SECRET not configured");
					return Effect.succeed(
						jsonResponse({ error: "Webhook secret not configured" }, 500),
					);
				},
				WebhookMissingHeader: () =>
					Effect.succeed(
						jsonResponse({ error: "Missing signature header" }, 401),
					),
				WebhookSignatureInvalid: () =>
					Effect.succeed(jsonResponse({ error: "Invalid signature" }, 401)),
				InvalidPayload: (e) =>
					Effect.succeed(jsonResponse({ error: e.message }, 400)),
			}),
		);

		return Effect.runPromise(handled);
	}),
});

export default http;
