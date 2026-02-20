import { Context, Data, Effect, Layer } from "effect";
import { getInstallationToken } from "./githubApp";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GitHubApiError extends Data.TaggedError("GitHubApiError")<{
	readonly status: number;
	readonly message: string;
	readonly url: string;
}> {}

/**
 * Thrown when GitHub returns a rate limit response (429 or 403 with
 * rate-limit headers). Includes the `retryAfterMs` hint from the
 * `Retry-After` / `X-RateLimit-Reset` headers so callers can back off.
 */
export class GitHubRateLimitError extends Data.TaggedError(
	"GitHubRateLimitError",
)<{
	readonly status: number;
	readonly message: string;
	readonly url: string;
	readonly retryAfterMs: number;
}> {}

// ---------------------------------------------------------------------------
// GitHub API Client
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.github.com";

type IGitHubApiClient = Readonly<{
	/**
	 * Execute any fetch against the GitHub REST API.
	 * Handles auth headers, base URL resolution, and error wrapping.
	 *
	 * May fail with `GitHubRateLimitError` when GitHub returns 429
	 * or a 403 with `X-RateLimit-Remaining: 0`.
	 */
	use: <A>(
		fn: (
			fetch: (path: string, init?: RequestInit) => Promise<Response>,
		) => Promise<A>,
	) => Effect.Effect<A, GitHubApiError | GitHubRateLimitError>;
}>;

// ---------------------------------------------------------------------------
// Rate-limit detection helpers
// ---------------------------------------------------------------------------

/**
 * Parse the number of milliseconds to wait from GitHub rate-limit response
 * headers. Checks `Retry-After` (seconds) first, then falls back to
 * `X-RateLimit-Reset` (Unix epoch seconds).
 */
const parseRetryAfterMs = (res: Response): number => {
	const retryAfter = res.headers.get("Retry-After");
	if (retryAfter) {
		const secs = Number(retryAfter);
		if (!Number.isNaN(secs) && secs > 0) return secs * 1_000;
	}

	const resetEpoch = res.headers.get("X-RateLimit-Reset");
	if (resetEpoch) {
		const resetMs = Number(resetEpoch) * 1_000;
		const delta = resetMs - Date.now();
		if (delta > 0) return delta;
	}

	// Fallback: 60 seconds (conservative)
	return 60_000;
};

/**
 * Returns true when a GitHub response indicates a rate limit.
 * GitHub uses 429 for primary rate limits and 403 with specific
 * headers/messages for secondary (abuse) rate limits.
 */
const isRateLimitResponse = (res: Response): boolean => {
	if (res.status === 429) return true;
	if (res.status === 403) {
		const remaining = res.headers.get("X-RateLimit-Remaining");
		if (remaining === "0") return true;
	}
	return false;
};

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

const makeClient = (token: string): IGitHubApiClient => {
	const headers: Record<string, string> = {
		Authorization: `token ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};

	const authedFetch = async (
		path: string,
		init?: RequestInit,
	): Promise<Response> => {
		const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
		const res = await fetch(url, {
			...init,
			headers: { ...headers, ...init?.headers },
		});

		// Detect rate-limit responses before returning to the caller.
		// Throwing here causes the outer Effect.tryPromise to surface the
		// error, which the workflow retry policy will handle.
		if (isRateLimitResponse(res)) {
			throw new GitHubRateLimitError({
				status: res.status,
				message: `GitHub rate limit hit (${res.status}). Retry after ${Math.round(parseRetryAfterMs(res) / 1_000)}s.`,
				url: res.url,
				retryAfterMs: parseRetryAfterMs(res),
			});
		}

		return res;
	};

	const use: IGitHubApiClient["use"] = (fn) =>
		Effect.tryPromise({
			try: () => fn(authedFetch),
			catch: (cause) => {
				// Preserve GitHubRateLimitError so it propagates with its tag
				if (cause instanceof GitHubRateLimitError) return cause;
				return new GitHubApiError({
					status: 0,
					message: String(cause),
					url: "unknown",
				});
			},
		}).pipe(Effect.withSpan("github_api.use"));

	return { use };
};

export class GitHubApiClient extends Context.Tag("@quickhub/GitHubApiClient")<
	GitHubApiClient,
	IGitHubApiClient
>() {
	/**
	 * Construct a client layer from an explicit OAuth token string.
	 */
	static fromToken = (token: string) => Layer.succeed(this, makeClient(token));

	/**
	 * Construct a client layer from a GitHub App installation ID.
	 *
	 * Fetches a short-lived installation access token via the App's JWT,
	 * then builds a client using that token. The token is cached in-memory
	 * by `getInstallationToken` (see `githubApp.ts`).
	 *
	 * Use this when no user OAuth token is available — e.g. repos added
	 * via the GitHub App installation flow (webhooks) where there is no
	 * `connectedByUserId`.
	 */
	static fromInstallation = (installationId: number) =>
		Layer.effect(
			this,
			Effect.gen(function* () {
				const token = yield* getInstallationToken(installationId);
				return makeClient(token);
			}),
		);
}
