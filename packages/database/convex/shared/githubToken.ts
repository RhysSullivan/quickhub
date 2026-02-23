/**
 * githubToken — Helpers for resolving the GitHub OAuth token to use for
 * API calls. The token always lives in exactly one place: the better-auth
 * `account` table. We never copy it.
 *
 * Four lookup patterns:
 * 1. `getUserGitHubToken(ctx)` — for vanilla actions with a user session.
 * 2. `lookupGitHubTokenByUserId(runQuery, runMutation, userId)` — for
 *    vanilla Convex actions that know the Better Auth user ID.
 * 3. `lookupGitHubTokenByUserIdConfect(runQuery, runMutation, userId)` —
 *    Confect variant where `runQuery` / `runMutation` return `Effect`.
 * 4. `resolveRepoToken(runQuery, connectedByUserId, installationId)` —
 *    background repo sync path using installation tokens.
 */
import type {
	FunctionReference,
	GenericActionCtx,
	GenericDataModel,
} from "convex/server";
import { Data, Effect, Either, Option as Opt, Schema } from "effect";
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

type RunQueryFn = <Output>(
	query: FunctionReference<
		"query",
		"internal",
		Record<string, unknown>,
		Output
	>,
	args: Record<string, unknown>,
) => Promise<Output>;

type RunMutationFn = <Output>(
	mutation: FunctionReference<
		"mutation",
		"internal",
		Record<string, unknown>,
		Output
	>,
	args: Record<string, unknown>,
) => Promise<Output>;

type AccountWhereField = "providerId" | "userId";

type ConfectFindOneRunQuery = (
	query: typeof components.betterAuth.adapter.findOne,
	args: {
		model: "account";
		where: Array<{ field: AccountWhereField; value: string }>;
	},
) => Effect.Effect<unknown>;

type ConfectUpdateOneRunMutation = (
	mutation: typeof components.betterAuth.adapter.updateOne,
	args: {
		input: {
			model: "account";
			update: {
				accessToken?: string | null;
				refreshToken?: string | null;
				accessTokenExpiresAt?: number | null;
				refreshTokenExpiresAt?: number | null;
				scope?: string | null;
				updatedAt?: number;
			};
			where: Array<{ field: AccountWhereField; value: string }>;
		};
	},
) => Effect.Effect<unknown>;

const OAuthAccountSchema = Schema.Struct({
	providerId: Schema.String,
	userId: Schema.String,
	accountId: Schema.String,
	accessToken: Schema.optional(Schema.NullOr(Schema.String)),
	refreshToken: Schema.optional(Schema.NullOr(Schema.String)),
	accessTokenExpiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
	refreshTokenExpiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
	scope: Schema.optional(Schema.NullOr(Schema.String)),
});

const decodeOAuthAccount = Schema.decodeUnknownEither(OAuthAccountSchema);

const GitHubTokenRefreshResponseSchema = Schema.Struct({
	access_token: Schema.optional(Schema.String),
	refresh_token: Schema.optional(Schema.String),
	expires_in: Schema.optional(Schema.Number),
	refresh_token_expires_in: Schema.optional(Schema.Number),
	scope: Schema.optional(Schema.String),
	error: Schema.optional(Schema.String),
	error_description: Schema.optional(Schema.String),
});

const decodeGitHubTokenRefreshResponse = Schema.decodeUnknownEither(
	GitHubTokenRefreshResponseSchema,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

type TokenResolutionOptions = {
	readonly forceRefresh?: boolean;
};

const getOAuthClientCredentials = (providerId: string) => {
	if (providerId === "github") {
		const clientId = process.env.GITHUB_CLIENT_ID ?? "";
		const clientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";
		if (clientId.length === 0 || clientSecret.length === 0) {
			return null;
		}
		return { clientId, clientSecret };
	}

	if (providerId === "github-notifications") {
		const clientId = process.env.GITHUB_NOTIFICATIONS_CLIENT_ID ?? "";
		const clientSecret = process.env.GITHUB_NOTIFICATIONS_CLIENT_SECRET ?? "";
		if (clientId.length === 0 || clientSecret.length === 0) {
			return null;
		}
		return { clientId, clientSecret };
	}

	return null;
};

const isTokenInRefreshWindow = (accessTokenExpiresAt: number | null) => {
	if (accessTokenExpiresAt === null) {
		return false;
	}

	return accessTokenExpiresAt - ACCESS_TOKEN_REFRESH_BUFFER_MS <= Date.now();
};

const isTokenExpired = (accessTokenExpiresAt: number | null) => {
	if (accessTokenExpiresAt === null) {
		return false;
	}

	return accessTokenExpiresAt <= Date.now();
};

const refreshGitHubOAuthToken = (providerId: string, refreshToken: string) =>
	Effect.gen(function* () {
		const credentials = getOAuthClientCredentials(providerId);
		if (credentials === null) {
			return yield* new NoGitHubTokenError({
				reason: `OAuth credentials are missing for provider ${providerId}`,
			});
		}

		const body = new URLSearchParams({
			client_id: credentials.clientId,
			client_secret: credentials.clientSecret,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		});

		const response = yield* Effect.tryPromise({
			try: () =>
				fetch("https://github.com/login/oauth/access_token", {
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body,
				}),
			catch: (error) =>
				new NoGitHubTokenError({
					reason: `Failed to refresh OAuth token for ${providerId}: ${String(error)}`,
				}),
		});

		if (!response.ok) {
			const responseText = yield* Effect.tryPromise({
				try: () => response.text(),
				catch: (error) =>
					new NoGitHubTokenError({
						reason: `Failed to read OAuth refresh error response for ${providerId}: ${String(error)}`,
					}),
			});
			return yield* new NoGitHubTokenError({
				reason: `GitHub OAuth token refresh failed (${response.status}): ${responseText}`,
			});
		}

		const responseJson = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: (error) =>
				new NoGitHubTokenError({
					reason: `Failed to parse OAuth refresh response for ${providerId}: ${String(error)}`,
				}),
		});

		const decoded = decodeGitHubTokenRefreshResponse(responseJson);
		if (Either.isLeft(decoded)) {
			return yield* new NoGitHubTokenError({
				reason: `GitHub OAuth refresh response was invalid for ${providerId}`,
			});
		}

		if (decoded.right.error !== undefined) {
			return yield* new NoGitHubTokenError({
				reason: `GitHub OAuth refresh failed for ${providerId}: ${decoded.right.error_description ?? decoded.right.error}`,
			});
		}

		if (decoded.right.access_token === undefined) {
			return yield* new NoGitHubTokenError({
				reason: `GitHub OAuth refresh did not return an access token for ${providerId}`,
			});
		}

		const now = Date.now();
		return {
			accessToken: decoded.right.access_token,
			refreshToken: decoded.right.refresh_token ?? null,
			scope: decoded.right.scope ?? null,
			accessTokenExpiresAt:
				decoded.right.expires_in !== undefined
					? now + decoded.right.expires_in * 1000
					: null,
			refreshTokenExpiresAt:
				decoded.right.refresh_token_expires_in !== undefined
					? now + decoded.right.refresh_token_expires_in * 1000
					: null,
		};
	});

const decodeAccount = (
	account: unknown,
	providerId: string,
	userId: string,
): Effect.Effect<
	Schema.Schema.Type<typeof OAuthAccountSchema>,
	NoGitHubTokenError
> => {
	const decoded = decodeOAuthAccount(account);
	if (Either.isLeft(decoded)) {
		return new NoGitHubTokenError({
			reason: `No ${providerId} OAuth account found for userId ${userId}`,
		});
	}

	if (
		decoded.right.providerId !== providerId ||
		decoded.right.userId !== userId
	) {
		return new NoGitHubTokenError({
			reason: `No ${providerId} OAuth account found for userId ${userId}`,
		});
	}

	return Effect.succeed(decoded.right);
};

const resolveAccountAccessToken = (
	account: Schema.Schema.Type<typeof OAuthAccountSchema>,
	providerId: string,
	persistTokenUpdate: (args: {
		accessToken: string;
		refreshToken: string | null;
		accessTokenExpiresAt: number | null;
		refreshTokenExpiresAt: number | null;
		scope: string | null;
	}) => Effect.Effect<void>,
	reloadLatestAccount: () => Effect.Effect<
		Schema.Schema.Type<typeof OAuthAccountSchema>,
		NoGitHubTokenError
	>,
	options?: TokenResolutionOptions,
): Effect.Effect<string, NoGitHubTokenError> =>
	Effect.gen(function* () {
		const accessToken = account.accessToken ?? null;
		const forceRefresh = options?.forceRefresh === true;

		const accessTokenExpiresAt = account.accessTokenExpiresAt ?? null;
		if (
			!forceRefresh &&
			accessToken !== null &&
			!isTokenInRefreshWindow(accessTokenExpiresAt)
		) {
			return accessToken;
		}

		const refreshToken = account.refreshToken ?? null;
		if (refreshToken === null) {
			if (
				!forceRefresh &&
				accessToken !== null &&
				!isTokenExpired(accessTokenExpiresAt)
			) {
				return accessToken;
			}

			if (accessToken === null) {
				return yield* new NoGitHubTokenError({
					reason: `No ${providerId} OAuth access token is stored for userId ${account.userId}`,
				});
			}

			return yield* new NoGitHubTokenError({
				reason: `${providerId} OAuth token is expired and no refresh token is available for userId ${account.userId}`,
			});
		}

		const refreshedEither = yield* refreshGitHubOAuthToken(
			providerId,
			refreshToken,
		).pipe(Effect.either);

		if (Either.isLeft(refreshedEither)) {
			if (
				!forceRefresh &&
				accessToken !== null &&
				!isTokenExpired(accessTokenExpiresAt)
			) {
				return accessToken;
			}

			const latestAccountOption = yield* reloadLatestAccount().pipe(
				Effect.option,
			);
			if (Opt.isSome(latestAccountOption)) {
				const latestAccount = latestAccountOption.value;
				const latestAccessToken = latestAccount.accessToken ?? null;
				const latestAccessTokenExpiresAt =
					latestAccount.accessTokenExpiresAt ?? null;

				if (
					latestAccessToken !== null &&
					!isTokenExpired(latestAccessTokenExpiresAt)
				) {
					return latestAccessToken;
				}

				const latestRefreshToken = latestAccount.refreshToken ?? null;
				if (
					latestRefreshToken !== null &&
					latestRefreshToken !== refreshToken
				) {
					const retriedRefresh = yield* refreshGitHubOAuthToken(
						providerId,
						latestRefreshToken,
					).pipe(Effect.either);

					if (Either.isRight(retriedRefresh)) {
						const refreshed = retriedRefresh.right;
						const nextRefreshToken =
							refreshed.refreshToken ?? latestRefreshToken;

						yield* persistTokenUpdate({
							accessToken: refreshed.accessToken,
							refreshToken: nextRefreshToken,
							accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
							refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
							scope: refreshed.scope,
						}).pipe(
							Effect.catchAll(
								(error) =>
									new NoGitHubTokenError({
										reason: `Refreshed ${providerId} OAuth token but failed to persist account update for userId ${account.userId}: ${String(error)}`,
									}),
							),
						);

						return refreshed.accessToken;
					}
				}
			}

			return yield* refreshedEither.left;
		}

		const refreshed = refreshedEither.right;

		const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
		yield* persistTokenUpdate({
			accessToken: refreshed.accessToken,
			refreshToken: nextRefreshToken,
			accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
			refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
			scope: refreshed.scope,
		}).pipe(
			Effect.catchAll(
				(error) =>
					new NoGitHubTokenError({
						reason: `Refreshed ${providerId} OAuth token but failed to persist account update for userId ${account.userId}: ${String(error)}`,
					}),
			),
		);

		return refreshed.accessToken;
	});

const lookupTokenViaRunQuery = (
	runQuery: RunQueryFn,
	runMutation: RunMutationFn,
	providerId: string,
	userId: string,
	options?: TokenResolutionOptions,
): Effect.Effect<string, NoGitHubTokenError> =>
	Effect.gen(function* () {
		const account = yield* Effect.promise(() =>
			runQuery(components.betterAuth.adapter.findOne, {
				model: "account" as const,
				where: [
					{ field: "providerId", value: providerId },
					{ field: "userId", value: userId },
				],
			}),
		);

		const decoded = yield* decodeAccount(account, providerId, userId);

		return yield* resolveAccountAccessToken(
			decoded,
			providerId,
			(update) =>
				Effect.promise(() =>
					runMutation(components.betterAuth.adapter.updateOne, {
						input: {
							model: "account",
							where: [
								{ field: "providerId", value: providerId },
								{ field: "userId", value: userId },
							],
							update: {
								accessToken: update.accessToken,
								refreshToken: update.refreshToken,
								accessTokenExpiresAt: update.accessTokenExpiresAt,
								refreshTokenExpiresAt: update.refreshTokenExpiresAt,
								scope: update.scope,
								updatedAt: Date.now(),
							},
						},
					}),
				).pipe(Effect.asVoid),
			() =>
				Effect.gen(function* () {
					const latestAccount = yield* Effect.promise(() =>
						runQuery(components.betterAuth.adapter.findOne, {
							model: "account" as const,
							where: [
								{ field: "providerId", value: providerId },
								{ field: "userId", value: userId },
							],
						}),
					);
					return yield* decodeAccount(latestAccount, providerId, userId);
				}),
			options,
		);
	});

// ---------------------------------------------------------------------------
// 1. Look up the signed-in user's token (vanilla Convex action)
// ---------------------------------------------------------------------------

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

		return yield* lookupTokenViaRunQuery(
			ctx.runQuery,
			ctx.runMutation,
			"github",
			String(user._id),
		);
	});

// ---------------------------------------------------------------------------
// 2. Look up token by Better Auth user ID (vanilla Convex)
// ---------------------------------------------------------------------------

export const lookupGitHubTokenByUserId = (
	runQuery: RunQueryFn,
	runMutation: RunMutationFn,
	userId: string,
	options?: TokenResolutionOptions,
): Effect.Effect<string, NoGitHubTokenError> =>
	lookupTokenViaRunQuery(runQuery, runMutation, "github", userId, options);

// ---------------------------------------------------------------------------
// 3. Look up token by Better Auth user ID (Confect)
// ---------------------------------------------------------------------------

export const lookupGitHubTokenByUserIdConfect = (
	runQuery: ConfectFindOneRunQuery,
	runMutation: ConfectUpdateOneRunMutation,
	userId: string,
	options?: TokenResolutionOptions,
): Effect.Effect<string, NoGitHubTokenError> =>
	Effect.gen(function* () {
		const account = yield* runQuery(components.betterAuth.adapter.findOne, {
			model: "account" as const,
			where: [
				{ field: "providerId", value: "github" },
				{ field: "userId", value: userId },
			],
		});

		const decoded = yield* decodeAccount(account, "github", userId);

		return yield* resolveAccountAccessToken(
			decoded,
			"github",
			(update) =>
				runMutation(components.betterAuth.adapter.updateOne, {
					input: {
						model: "account",
						where: [
							{ field: "providerId", value: "github" },
							{ field: "userId", value: userId },
						],
						update: {
							accessToken: update.accessToken,
							refreshToken: update.refreshToken,
							accessTokenExpiresAt: update.accessTokenExpiresAt,
							refreshTokenExpiresAt: update.refreshTokenExpiresAt,
							scope: update.scope,
							updatedAt: Date.now(),
						},
					},
				}).pipe(Effect.asVoid),
			() =>
				Effect.gen(function* () {
					const latestAccount = yield* runQuery(
						components.betterAuth.adapter.findOne,
						{
							model: "account" as const,
							where: [
								{ field: "providerId", value: "github" },
								{ field: "userId", value: userId },
							],
						},
					);
					return yield* decodeAccount(latestAccount, "github", userId);
				}),
			options,
		);
	});

// ---------------------------------------------------------------------------
// 3b. Look up token by provider ID and user ID (Confect)
// ---------------------------------------------------------------------------

export const lookupTokenByProviderConfect = (
	runQuery: ConfectFindOneRunQuery,
	runMutation: ConfectUpdateOneRunMutation,
	providerId: string,
	userId: string,
	options?: TokenResolutionOptions,
): Effect.Effect<string, NoGitHubTokenError> =>
	Effect.gen(function* () {
		const account = yield* runQuery(components.betterAuth.adapter.findOne, {
			model: "account" as const,
			where: [
				{ field: "providerId", value: providerId },
				{ field: "userId", value: userId },
			],
		});

		const decoded = yield* decodeAccount(account, providerId, userId);

		return yield* resolveAccountAccessToken(
			decoded,
			providerId,
			(update) =>
				runMutation(components.betterAuth.adapter.updateOne, {
					input: {
						model: "account",
						where: [
							{ field: "providerId", value: providerId },
							{ field: "userId", value: userId },
						],
						update: {
							accessToken: update.accessToken,
							refreshToken: update.refreshToken,
							accessTokenExpiresAt: update.accessTokenExpiresAt,
							refreshTokenExpiresAt: update.refreshTokenExpiresAt,
							scope: update.scope,
							updatedAt: Date.now(),
						},
					},
				}).pipe(Effect.asVoid),
			() =>
				Effect.gen(function* () {
					const latestAccount = yield* runQuery(
						components.betterAuth.adapter.findOne,
						{
							model: "account" as const,
							where: [
								{ field: "providerId", value: providerId },
								{ field: "userId", value: userId },
							],
						},
					);
					return yield* decodeAccount(latestAccount, providerId, userId);
				}),
			options,
		);
	});

// ---------------------------------------------------------------------------
// 4. Resolve token for a repo — installation token for sync flows
// ---------------------------------------------------------------------------

export const resolveRepoToken = (
	runQuery: RunQueryFn,
	connectedByUserId: string | null | undefined,
	installationId: number,
): Effect.Effect<
	string,
	NoGitHubTokenError | GitHubAppConfigMissing | GitHubAppTokenError
> =>
	Effect.gen(function* () {
		void runQuery;
		void connectedByUserId;

		if (installationId > 0) {
			return yield* getInstallationToken(installationId);
		}

		return yield* new NoGitHubTokenError({
			reason: `No installation token available: installationId=${installationId}`,
		});
	});
