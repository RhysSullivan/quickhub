import { Context, Data, Effect, Layer } from "effect";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GitHubApiError extends Data.TaggedError("GitHubApiError")<{
	readonly status: number;
	readonly message: string;
	readonly url: string;
}> {}

export class GitHubTokenMissing extends Data.TaggedError(
	"GitHubTokenMissing",
)<{}> {}

// ---------------------------------------------------------------------------
// Token Provider (abstracts PAT vs. GitHub App installation tokens)
// ---------------------------------------------------------------------------

/**
 * A service that provides a GitHub API token.
 *
 * Current implementation: reads `GITHUB_PAT` from environment.
 * Future: `InstallationTokenProvider` fetches short-lived installation
 * tokens from a GitHub App, keyed by installation ID.
 */
type IGitHubTokenProvider = Readonly<{
	/**
	 * Get a valid GitHub API token.
	 *
	 * For PAT, this is a static string read from env.
	 * For GitHub App installation tokens, this may involve a fetch
	 * and caching with expiry.
	 *
	 * Missing/expired tokens should die (configuration error), not
	 * fail with a typed error — callers cannot recover from auth
	 * misconfiguration.
	 */
	getToken: Effect.Effect<string>;
}>;

export class GitHubTokenProvider extends Context.Tag(
	"@quickhub/GitHubTokenProvider",
)<GitHubTokenProvider, IGitHubTokenProvider>() {
	/**
	 * Reads GITHUB_PAT from process.env.
	 * Dies with GitHubTokenMissing if not set (unrecoverable config error).
	 */
	static Pat = Layer.succeed(
		this,
		GitHubTokenProvider.of({
			getToken: Effect.suspend(() => {
				const token = process.env.GITHUB_PAT;
				if (!token) {
					return Effect.die(new GitHubTokenMissing());
				}
				return Effect.succeed(token);
			}),
		}),
	);
}

// ---------------------------------------------------------------------------
// GitHub API Client
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.github.com";

type IGitHubApiClient = Readonly<{
	/**
	 * Execute any fetch against the GitHub REST API.
	 * Handles auth headers, base URL resolution, and error wrapping.
	 */
	use: <A>(
		fn: (
			fetch: (path: string, init?: RequestInit) => Promise<Response>,
		) => Promise<A>,
	) => Effect.Effect<A, GitHubApiError>;
}>;

const makeClient = (token: string): IGitHubApiClient => {
	const headers: Record<string, string> = {
		Authorization: `token ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};

	const authedFetch = (path: string, init?: RequestInit): Promise<Response> => {
		const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
		return fetch(url, {
			...init,
			headers: { ...headers, ...init?.headers },
		});
	};

	const use: IGitHubApiClient["use"] = (fn) =>
		Effect.tryPromise({
			try: () => fn(authedFetch),
			catch: (cause) =>
				new GitHubApiError({
					status: 0,
					message: String(cause),
					url: "unknown",
				}),
		}).pipe(Effect.withSpan("github_api.use"));

	return { use };
};

/**
 * Constructs a GitHubApiClient by obtaining a token from
 * the GitHubTokenProvider service.
 */
const make = Effect.gen(function* () {
	const provider = yield* GitHubTokenProvider;
	const token = yield* provider.getToken;
	return makeClient(token);
});

export class GitHubApiClient extends Context.Tag("@quickhub/GitHubApiClient")<
	GitHubApiClient,
	IGitHubApiClient
>() {
	/**
	 * Layer that constructs the client from a GitHubTokenProvider.
	 * Requires GitHubTokenProvider to be provided in the context.
	 */
	static Default = Layer.effect(this, make).pipe(
		Layer.annotateSpans({ module: "GitHubApiClient" }),
	);

	/**
	 * Production layer: GitHubApiClient backed by PAT from environment.
	 * This is the drop-in replacement for the old `Default` that read
	 * process.env directly.
	 *
	 * When migrating to GitHub App tokens, replace `GitHubTokenProvider.Pat`
	 * with `GitHubTokenProvider.Installation(installationId)`.
	 */
	static Live = Layer.provide(this.Default, GitHubTokenProvider.Pat);

	/**
	 * Test/manual layer: construct a client from an explicit token string.
	 */
	static fromToken = (token: string) => Layer.succeed(this, makeClient(token));
}
