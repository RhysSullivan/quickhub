import { Data, Effect } from "effect";

const RSA_ENCRYPTION_OID = Uint8Array.of(
	0x2a,
	0x86,
	0x48,
	0x86,
	0xf7,
	0x0d,
	0x01,
	0x01,
	0x01,
);

const DER_NULL = Uint8Array.of(0x05, 0x00);

const concatBytes = (chunks: ReadonlyArray<Uint8Array>) => {
	let totalLength = 0;
	for (const chunk of chunks) {
		totalLength += chunk.length;
	}

	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}

	return result;
};

const encodeDerLength = (length: number) => {
	if (length < 0x80) {
		return Uint8Array.of(length);
	}

	const lengthBytes: Array<number> = [];
	let remaining = length;
	while (remaining > 0) {
		lengthBytes.unshift(remaining & 0xff);
		remaining = Math.floor(remaining / 256);
	}

	return Uint8Array.of(0x80 | lengthBytes.length, ...lengthBytes);
};

const encodeDer = (tag: number, value: Uint8Array) =>
	concatBytes([Uint8Array.of(tag), encodeDerLength(value.length), value]);

const encodeBase64Url = (data: Uint8Array | string) => {
	const bytes =
		typeof data === "string" ? new TextEncoder().encode(data) : data;

	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	const base64 = btoa(binary);
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const parsePemToPkcs8 = (privateKeyPem: string): Uint8Array => {
	const pkcs8Match = privateKeyPem.match(
		/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/,
	);
	if (pkcs8Match && pkcs8Match[1]) {
		const derBody = pkcs8Match[1].replace(/\s/g, "");
		return Uint8Array.from(atob(derBody), (char) => char.charCodeAt(0));
	}

	const pkcs1Match = privateKeyPem.match(
		/-----BEGIN RSA PRIVATE KEY-----([\s\S]*?)-----END RSA PRIVATE KEY-----/,
	);
	if (!pkcs1Match || !pkcs1Match[1]) {
		throw new Error("Unsupported private key format");
	}

	const pkcs1Body = pkcs1Match[1].replace(/\s/g, "");
	const pkcs1Der = Uint8Array.from(atob(pkcs1Body), (char) =>
		char.charCodeAt(0),
	);

	const version = encodeDer(0x02, Uint8Array.of(0x00));
	const algorithmIdentifier = encodeDer(
		0x30,
		concatBytes([encodeDer(0x06, RSA_ENCRYPTION_OID), DER_NULL]),
	);
	const privateKey = encodeDer(0x04, pkcs1Der);

	return encodeDer(
		0x30,
		concatBytes([version, algorithmIdentifier, privateKey]),
	);
};

const toArrayBuffer = (bytes: Uint8Array) => {
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy.buffer;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GitHubAppConfigMissing extends Data.TaggedError(
	"GitHubAppConfigMissing",
)<{
	readonly field: string;
}> {}

export class GitHubAppTokenError extends Data.TaggedError(
	"GitHubAppTokenError",
)<{
	readonly message: string;
	readonly status: number;
}> {}

// ---------------------------------------------------------------------------
// JWT generation for GitHub App authentication
// ---------------------------------------------------------------------------

/**
 * Create a JSON Web Token (JWT) for GitHub App authentication.
 *
 * GitHub Apps authenticate by signing a JWT with their private key.
 * The JWT is used to request installation access tokens.
 *
 * @see https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
const createAppJwt = (
	appClientId: string,
	privateKeyPem: string,
): Effect.Effect<string, GitHubAppTokenError> =>
	Effect.tryPromise({
		try: async () => {
			// JWT header
			const header = { alg: "RS256", typ: "JWT" };

			// JWT payload — issued 60s in the past, expires in 10 minutes
			const now = Math.floor(Date.now() / 1000);
			const payload = {
				iat: now - 60,
				exp: now + 10 * 60,
				iss: appClientId,
			};

			const headerB64 = encodeBase64Url(JSON.stringify(header));
			const payloadB64 = encodeBase64Url(JSON.stringify(payload));
			const signingInput = `${headerB64}.${payloadB64}`;

			// Import the PEM private key for signing
			const binaryDer = parsePemToPkcs8(privateKeyPem);

			const cryptoKey = await crypto.subtle.importKey(
				"pkcs8",
				toArrayBuffer(binaryDer),
				{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
				false,
				["sign"],
			);

			// Sign
			const signatureBuffer = await crypto.subtle.sign(
				"RSASSA-PKCS1-v1_5",
				cryptoKey,
				new TextEncoder().encode(signingInput),
			);

			const signatureB64 = encodeBase64Url(new Uint8Array(signatureBuffer));

			return `${signingInput}.${signatureB64}`;
		},
		catch: (cause) =>
			new GitHubAppTokenError({
				message: `Failed to create App JWT: ${String(cause)}`,
				status: 0,
			}),
	});

// ---------------------------------------------------------------------------
// Installation token fetching
// ---------------------------------------------------------------------------

interface InstallationTokenResponse {
	readonly token: string;
	readonly expires_at: string;
}

/**
 * Request an installation access token from GitHub.
 *
 * Uses the App JWT to authenticate, then requests a short-lived
 * installation token (valid for 1 hour).
 *
 * @see https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
 */
export const fetchInstallationToken = (
	installationId: number,
): Effect.Effect<
	InstallationTokenResponse,
	GitHubAppConfigMissing | GitHubAppTokenError
> =>
	Effect.gen(function* () {
		const appClientId = process.env.GITHUB_CLIENT_ID;
		if (!appClientId) {
			return yield* new GitHubAppConfigMissing({
				field: "GITHUB_CLIENT_ID",
			});
		}

		const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
		if (!privateKey) {
			return yield* new GitHubAppConfigMissing({
				field: "GITHUB_APP_PRIVATE_KEY",
			});
		}

		const jwt = yield* createAppJwt(appClientId, privateKey);

		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(
					`https://api.github.com/app/installations/${installationId}/access_tokens`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${jwt}`,
							Accept: "application/vnd.github+json",
							"X-GitHub-Api-Version": "2022-11-28",
						},
					},
				),
			catch: (cause) =>
				new GitHubAppTokenError({
					message: `Failed to fetch installation token: ${String(cause)}`,
					status: 0,
				}),
		});

		if (!response.ok) {
			const body = yield* Effect.tryPromise({
				try: () => response.text(),
				catch: () =>
					new GitHubAppTokenError({
						message: `Installation token request failed with status ${response.status}`,
						status: response.status,
					}),
			});
			return yield* new GitHubAppTokenError({
				message: `Installation token request failed (${response.status}): ${body}`,
				status: response.status,
			});
		}

		const data: InstallationTokenResponse = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () =>
				new GitHubAppTokenError({
					message: "Failed to parse installation token response",
					status: 0,
				}),
		});

		return data;
	}).pipe(Effect.withSpan("github_app.fetchInstallationToken"));

// ---------------------------------------------------------------------------
// In-memory token cache
// ---------------------------------------------------------------------------

/**
 * Simple in-memory cache for installation tokens.
 * Tokens are cached until 5 minutes before expiry to avoid
 * using tokens that are about to expire during long operations.
 */
const tokenCache = new Map<number, { token: string; expiresAt: number }>();

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get a valid installation token, using the cache when possible.
 * Falls back to fetching a new token if the cached one is expired.
 */
export const getInstallationToken = (
	installationId: number,
): Effect.Effect<string, GitHubAppConfigMissing | GitHubAppTokenError> =>
	Effect.gen(function* () {
		const cached = tokenCache.get(installationId);
		const now = Date.now();

		if (cached && cached.expiresAt - EXPIRY_BUFFER_MS > now) {
			return cached.token;
		}

		const result = yield* fetchInstallationToken(installationId);

		tokenCache.set(installationId, {
			token: result.token,
			expiresAt: new Date(result.expires_at).getTime(),
		});

		return result.token;
	}).pipe(Effect.withSpan("github_app.getInstallationToken"));
