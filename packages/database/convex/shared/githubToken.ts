/**
 * githubToken — Helpers for resolving the GitHub OAuth token to use for
 * API calls. The token always lives in exactly one place: the better-auth
 * `account` table. We never copy it.
 *
 * Four lookup patterns:
 * 1. `getUserGitHubToken(ctx)` — for vanilla actions with a user session.
 * 2. `lookupGitHubTokenByUserId(runQuery, userId)` — for vanilla Convex
 *    actions (bootstrap steps) that don't have a user session but know
 *    the `connectedByUserId` from the repo record.
 * 3. `lookupGitHubTokenByUserIdConfect(confectRunQuery, userId)` — for
 *    Confect actions/mutations where `ctx.runQuery` returns `Effect`.
 * 4. `resolveRepoToken(runQuery, connectedByUserId, installationId)` — tries
 *    the user token first, falls back to the GitHub App installation token.
 */
import type {
	FunctionReference,
	GenericActionCtx,
	GenericDataModel,
} from "convex/server";
import { Data, Effect } from "effect";
import { components } from "../_generated/api";
import { authComponent } from "../auth";
import {
	type GitHubAppConfigMissing,
	type GitHubAppTokenError,
	getInstallationToken,
} from "./githubApp";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NoGitHubTokenError extends Data.TaggedError("NoGitHubTokenError")<{
	readonly reason: string;
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Narrow callback type for the `runQuery` parameter of `lookupGitHubTokenByUserId`.
 *
 * We intentionally avoid using the full `GenericActionCtx<DataModel>["runQuery"]`
 * because of Convex's DataModel variance issue: a specific-DataModel `runQuery`
 * isn't assignable to `GenericDataModel`'s version. By using a narrow callback
 * type that matches the *exact* call we make (component query `findOne`), both
 * specific- and generic-DataModel `ctx.runQuery` satisfy this signature.
 */
type RunQueryFn = <Output>(
	query: FunctionReference<
		"query",
		"internal",
		Record<string, unknown>,
		Output
	>,
	args: Record<string, unknown>,
) => Promise<Output>;

/**
 * Confect variant: `runQuery` that returns `Effect.Effect<Output>` instead of
 * `Promise<Output>`, as used in `ConfectActionCtx` / `ConfectMutationCtx`.
 */
type ConfectRunQueryFn = <
	Query extends FunctionReference<"query", "public" | "internal">,
>(
	query: Query,
	...args: Parameters<
		typeof components.betterAuth.adapter.findOne extends FunctionReference<
			"query",
			infer _V,
			infer A,
			infer _O
		>
			? (q: Query, a: A) => void
			: never
	> extends [infer _Q, infer A]
		? [A]
		: never
) => Effect.Effect<unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Internal helper that queries the better-auth component adapter.
 * Accepts a `runQuery` callback with a narrow signature so both vanilla
 * Convex and Confect action contexts are assignable.
 */
const lookupTokenViaRunQuery = (
	runQuery: RunQueryFn,
	userId: string,
): Effect.Effect<string, NoGitHubTokenError> =>
	Effect.gen(function* () {
		const account = yield* Effect.promise(() =>
			runQuery(components.betterAuth.adapter.findOne, {
				model: "account" as const,
				where: [
					{ field: "providerId", value: "github" },
					{ field: "userId", value: userId },
				],
			}),
		);

		return yield* extractToken(account, userId);
	});

/**
 * Extract and validate the token from the account lookup result.
 */
const extractToken = (
	account: unknown,
	userId: string,
): Effect.Effect<string, NoGitHubTokenError> => {
	if (
		!account ||
		typeof account !== "object" ||
		!("accessToken" in account) ||
		!account.accessToken
	) {
		return new NoGitHubTokenError({
			reason: `No GitHub OAuth token found for userId ${userId}`,
		});
	}
	return Effect.succeed(String(account.accessToken));
};

// ---------------------------------------------------------------------------
// 1. Look up the signed-in user's token (vanilla Convex action)
// ---------------------------------------------------------------------------

/**
 * Get the signed-in user's GitHub OAuth access token.
 *
 * 1. `authComponent.safeGetAuthUser(ctx)` -> user doc
 * 2. Query `account` table for `providerId = "github"` + that user's ID
 * 3. Return `accessToken`
 *
 * Accepts `GenericActionCtx<GenericDataModel>` because
 * `authComponent.safeGetAuthUser` requires a full `GenericCtx`.
 */
export const getUserGitHubToken = (
	ctx: GenericActionCtx<GenericDataModel>,
): Effect.Effect<string, NoGitHubTokenError> =>
	Effect.gen(function* () {
		const user = yield* Effect.promise(() =>
			authComponent.safeGetAuthUser(ctx),
		);

		if (!user) {
			return yield* new NoGitHubTokenError({
				reason: "User is not signed in",
			});
		}

		return yield* lookupTokenViaRunQuery(ctx.runQuery, String(user._id));
	});

// ---------------------------------------------------------------------------
// 2. Look up the token by better-auth user ID (vanilla Convex action)
// ---------------------------------------------------------------------------

/**
 * Look up the GitHub token for a specific better-auth user ID.
 * Used by vanilla Convex actions (bootstrap steps, etc.) that don't have
 * a user session but know `connectedByUserId` from a repo record.
 *
 * Accepts a `runQuery` callback with a narrow generic signature so it
 * works with both specific-DataModel `ctx.runQuery` (from `internalAction`)
 * and generic-DataModel `ctx.runQuery`.
 */
export const lookupGitHubTokenByUserId = (
	runQuery: RunQueryFn,
	userId: string,
): Effect.Effect<string, NoGitHubTokenError> =>
	lookupTokenViaRunQuery(runQuery, userId);

// ---------------------------------------------------------------------------
// 3. Look up the token by better-auth user ID (Confect action/mutation)
// ---------------------------------------------------------------------------

/**
 * Look up the GitHub token for a specific better-auth user ID.
 * Used inside Confect action/mutation handlers where `ctx.runQuery`
 * returns `Effect.Effect` instead of `Promise`.
 *
 * @example
 * ```ts
 * const token = yield* lookupGitHubTokenByUserIdConfect(ctx.runQuery, userId);
 * ```
 */
export const lookupGitHubTokenByUserIdConfect = (
	runQuery: (
		query: typeof components.betterAuth.adapter.findOne,
		args: {
			model: "account";
			where: Array<{ field: string; value: string }>;
		},
	) => Effect.Effect<unknown>,
	userId: string,
): Effect.Effect<string, NoGitHubTokenError> =>
	Effect.gen(function* () {
		const account = yield* runQuery(components.betterAuth.adapter.findOne, {
			model: "account" as const,
			where: [
				{ field: "providerId", value: "github" },
				{ field: "userId", value: userId },
			],
		});

		return yield* extractToken(account, userId);
	});

// ---------------------------------------------------------------------------
// 4. Resolve token for a repo — user token preferred, installation fallback
// ---------------------------------------------------------------------------

/**
 * Resolve the best available GitHub API token for a repository.
 *
 * Prefers the user's OAuth token (via `connectedByUserId`) because it has
 * the user's permissions. Falls back to the GitHub App installation token
 * when no user token is available (e.g. repos added via the App installation
 * webhook that have no `connectedByUserId`).
 *
 * Returns the token string directly — callers use it with
 * `GitHubApiClient.fromToken(token)`.
 */
export const resolveRepoToken = (
	runQuery: RunQueryFn,
	connectedByUserId: string | null | undefined,
	installationId: number,
): Effect.Effect<
	string,
	NoGitHubTokenError | GitHubAppConfigMissing | GitHubAppTokenError
> =>
	Effect.gen(function* () {
		// Try user token first
		if (connectedByUserId) {
			const userTokenResult = yield* lookupTokenViaRunQuery(
				runQuery,
				connectedByUserId,
			).pipe(Effect.either);

			if (userTokenResult._tag === "Right") {
				return userTokenResult.right;
			}
			// User token not available — fall through to installation token
		}

		// Fall back to installation token (only if we have a real installation ID)
		if (installationId > 0) {
			return yield* getInstallationToken(installationId);
		}

		// Neither path worked
		return yield* new NoGitHubTokenError({
			reason: `No token available: connectedByUserId=${connectedByUserId ?? "null"}, installationId=${installationId}`,
		});
	});
