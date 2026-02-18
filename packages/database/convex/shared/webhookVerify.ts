import { Effect, Schema } from "effect";

/**
 * Verifies GitHub webhook HMAC-SHA256 signature.
 *
 * GitHub sends the signature in the `X-Hub-Signature-256` header as `sha256=<hex>`.
 * We recompute the HMAC using the shared secret and compare.
 */

class WebhookSignatureInvalid extends Schema.TaggedError<WebhookSignatureInvalid>()(
	"WebhookSignatureInvalid",
	{
		message: Schema.String,
	},
) {}

class WebhookMissingHeader extends Schema.TaggedError<WebhookMissingHeader>()(
	"WebhookMissingHeader",
	{
		header: Schema.String,
	},
) {}

/**
 * Timing-safe comparison of two hex strings using Web Crypto API.
 * Returns true if both strings are equal.
 */
const timingSafeEqual = (a: string, b: string): boolean => {
	if (a.length !== b.length) return false;
	const encoder = new TextEncoder();
	const aBuf = encoder.encode(a);
	const bBuf = encoder.encode(b);
	// Constant-time comparison
	let result = 0;
	for (let i = 0; i < aBuf.length; i++) {
		// biome-ignore lint/style/noNonNullAssertion: loop is bounded by length check
		result |= aBuf[i]! ^ bBuf[i]!;
	}
	return result === 0;
};

/**
 * Compute HMAC-SHA256 of the given body using the secret, and return the hex digest.
 */
const computeHmacSha256 = (
	secret: string,
	body: string,
): Effect.Effect<string> =>
	Effect.promise(async () => {
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const signature = await crypto.subtle.sign(
			"HMAC",
			key,
			encoder.encode(body),
		);
		const hashArray = Array.from(new Uint8Array(signature));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	});

/**
 * Verify a GitHub webhook signature against the raw body.
 *
 * @param signatureHeader - The value of X-Hub-Signature-256 header (e.g. "sha256=abc123...")
 * @param body - The raw request body as string
 * @param secret - The webhook secret
 * @returns Effect that succeeds with true if valid, or fails with WebhookSignatureInvalid
 */
export const verifyWebhookSignature = (
	signatureHeader: string | null,
	body: string,
	secret: string,
): Effect.Effect<true, WebhookSignatureInvalid | WebhookMissingHeader> =>
	Effect.gen(function* () {
		if (!signatureHeader) {
			return yield* new WebhookMissingHeader({
				header: "X-Hub-Signature-256",
			});
		}

		const prefix = "sha256=";
		if (!signatureHeader.startsWith(prefix)) {
			return yield* new WebhookSignatureInvalid({
				message: "Signature header does not start with sha256=",
			});
		}

		const providedHex = signatureHeader.slice(prefix.length);
		const computedHex = yield* computeHmacSha256(secret, body);

		if (!timingSafeEqual(providedHex, computedHex)) {
			return yield* new WebhookSignatureInvalid({
				message: "HMAC signature mismatch",
			});
		}

		return true as const;
	});

export { WebhookSignatureInvalid, WebhookMissingHeader };
