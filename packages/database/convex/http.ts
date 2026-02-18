import { httpRouter } from "convex/server";
import { Effect } from "effect";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { verifyWebhookSignature } from "./shared/webhookVerify";

const http = httpRouter();

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
		const body = await request.text();
		const signatureHeader = request.headers.get("X-Hub-Signature-256");
		const eventName = request.headers.get("X-GitHub-Event");
		const deliveryId = request.headers.get("X-GitHub-Delivery");

		// Reject requests missing required GitHub headers
		if (!eventName || !deliveryId) {
			return new Response(
				JSON.stringify({ error: "Missing required GitHub webhook headers" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		// Verify HMAC-SHA256 signature
		const secret = process.env.GITHUB_WEBHOOK_SECRET;
		if (!secret) {
			console.error("GITHUB_WEBHOOK_SECRET not configured");
			return new Response(
				JSON.stringify({ error: "Webhook secret not configured" }),
				{ status: 500, headers: { "Content-Type": "application/json" } },
			);
		}

		const verifyResult = await Effect.runPromise(
			Effect.either(verifyWebhookSignature(signatureHeader, body, secret)),
		);

		const signatureValid = verifyResult._tag === "Right";

		if (!signatureValid) {
			console.warn(
				`Webhook signature verification failed for delivery ${deliveryId}`,
			);
			return new Response(JSON.stringify({ error: "Invalid signature" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}

		// Parse payload to extract metadata
		let parsedPayload: Record<string, unknown> = {};
		try {
			parsedPayload = JSON.parse(body);
		} catch {
			return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		const action =
			typeof parsedPayload.action === "string" ? parsedPayload.action : null;

		const installation = parsedPayload.installation;
		const installationId =
			installation !== null &&
			installation !== undefined &&
			typeof installation === "object" &&
			"id" in installation &&
			typeof installation.id === "number"
				? installation.id
				: null;

		const repository = parsedPayload.repository;
		const repositoryId =
			repository !== null &&
			repository !== undefined &&
			typeof repository === "object" &&
			"id" in repository &&
			typeof repository.id === "number"
				? repository.id
				: null;

		// Store raw event (internal mutation handles dedup by deliveryId)
		await ctx.runMutation(internal.rpc.webhookIngestion.storeRawEvent, {
			deliveryId,
			eventName,
			action,
			installationId,
			repositoryId,
			signatureValid,
			payloadJson: body,
			receivedAt: Date.now(),
		});

		return new Response(JSON.stringify({ ok: true, deliveryId }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}),
});

export default http;
