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
// Service
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

const make = Effect.gen(function* () {
	const token = process.env.GITHUB_PAT;
	if (!token) {
		return yield* Effect.die(new GitHubTokenMissing());
	}
	return makeClient(token);
});

export class GitHubApiClient extends Context.Tag("@quickhub/GitHubApiClient")<
	GitHubApiClient,
	IGitHubApiClient
>() {
	static Default = Layer.effect(this, make).pipe(
		Layer.annotateSpans({ module: "GitHubApiClient" }),
	);

	static fromToken = (token: string) => Layer.succeed(this, makeClient(token));
}
