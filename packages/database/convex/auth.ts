import {
	type AuthFunctions,
	createClient,
	type GenericCtx,
} from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { admin, genericOAuth } from "better-auth/plugins";
import { type GenericDataModel, queryGeneric } from "convex/server";
import { Either, Schema } from "effect";
import { components, internal } from "./_generated/api";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";

const authFunctions: AuthFunctions = internal.auth;

const STATIC_TRUSTED_ORIGINS = [
	"https://fastergh.com",
	"https://www.fastergh.com",
	"http://localhost:4007",
	"http://localhost:3000",
	"https://localhost:4007",
	"https://localhost:3000",
	"https://local.rhys.dev",
];

const getTrustedOrigins = () => {
	const origins = [...STATIC_TRUSTED_ORIGINS];
	if (siteUrl !== undefined && siteUrl.length > 0) {
		try {
			origins.push(new URL(siteUrl).origin);
		} catch {
			// Ignore invalid SITE_URL format; static defaults still apply.
		}
	}
	return origins;
};

const GitHubUserSchema = Schema.Struct({
	id: Schema.Number,
	login: Schema.String,
	name: Schema.NullOr(Schema.String),
	avatar_url: Schema.String,
	email: Schema.NullOr(Schema.String),
});

const GitHubEmailSchema = Schema.Struct({
	email: Schema.String,
	primary: Schema.Boolean,
	verified: Schema.Boolean,
});

const decodeGitHubUser = Schema.decodeUnknownEither(GitHubUserSchema);
const decodeGitHubEmails = Schema.decodeUnknownEither(
	Schema.Array(GitHubEmailSchema),
);

// ---------------------------------------------------------------------------
// Better Auth component client (local install mode)
// ---------------------------------------------------------------------------

/**
 * We use GenericDataModel instead of our specific DataModel because Confect
 * generates readonly arrays (from Effect Schema) which are incompatible with
 * Convex's GenericDocument mutable array constraint. Better Auth only accesses
 * its own component tables through the adapter, so this is safe.
 */
export const authComponent = createClient<GenericDataModel, typeof authSchema>(
	components.betterAuth,
	{
		authFunctions,
		local: {
			schema: authSchema,
		},
		verbose: false,
		triggers: {
			account: {
				onCreate: async (ctx, account) => {
					if (account.providerId !== "github") return;
					await ctx.scheduler.runAfter(
						0,
						internal.rpc.githubActions.syncUserPermissions,
						{ userId: account.userId },
					);
				},
				onUpdate: async (ctx, newAccount) => {
					if (newAccount.providerId !== "github") return;
					await ctx.scheduler.runAfter(
						0,
						internal.rpc.githubActions.syncUserPermissions,
						{ userId: newAccount.userId },
					);
				},
			},
		},
	},
);

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

// ---------------------------------------------------------------------------
// Auth options factory
// ---------------------------------------------------------------------------

const siteUrl = process.env.SITE_URL;

export const createAuthOptions = (ctx: GenericCtx) => {
	return {
		baseURL: siteUrl,
		trustedOrigins: getTrustedOrigins,
		advanced: {
			disableCSRFCheck: true,
		},
		database: authComponent.adapter(ctx),
		account: {
			accountLinking: {
				enabled: true,
				allowDifferentEmails: false,
			},
		},
		user: {
			additionalFields: {
				role: {
					type: "string",
					required: false,
				},
			},
		},
		socialProviders: {
			github: {
				clientId: process.env.GITHUB_CLIENT_ID ?? "",
				clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
				// Full repo scope so the user's OAuth token can read/write repository data
				scope: ["read:user", "user:email", "repo"],
			},
		},
		plugins: [
			genericOAuth({
				config: [
					{
						providerId: "github-notifications",
						clientId: process.env.GITHUB_NOTIFICATIONS_CLIENT_ID ?? "",
						clientSecret: process.env.GITHUB_NOTIFICATIONS_CLIENT_SECRET ?? "",
						authorizationUrl: "https://github.com/login/oauth/authorize",
						tokenUrl: "https://github.com/login/oauth/access_token",
						scopes: ["notifications", "user:email"],
						getUserInfo: async (token) => {
							const [userRes, emailsRes] = await Promise.all([
								fetch("https://api.github.com/user", {
									headers: {
										Authorization: `Bearer ${token.accessToken}`,
									},
								}),
								fetch("https://api.github.com/user/emails", {
									headers: {
										Authorization: `Bearer ${token.accessToken}`,
									},
								}),
							]);
							const userResult = decodeGitHubUser(await userRes.json());
							if (Either.isLeft(userResult)) return null;
							const user = userResult.right;

							const emailsResult = decodeGitHubEmails(await emailsRes.json());
							if (Either.isLeft(emailsResult)) return null;
							const emails = emailsResult.right;
							const primaryEmail =
								emails.find((e) => e.primary && e.verified)?.email ??
								emails.find((e) => e.verified)?.email ??
								user.email;
							if (!primaryEmail) return null;
							return {
								id: String(user.id),
								name: user.name ?? user.login,
								email: primaryEmail,
								emailVerified: emails.some(
									(e) => e.email === primaryEmail && e.verified,
								),
								image: user.avatar_url,
							};
						},
					},
				],
			}),
			admin({
				impersonationSessionDuration: 60 * 60,
			}),
			crossDomain({
				siteUrl: siteUrl ?? "http://localhost:4007",
			}),
			convex({
				authConfig,
			}),
		],
	} satisfies BetterAuthOptions;
};

// ---------------------------------------------------------------------------
// Auth instance factory
// ---------------------------------------------------------------------------

export const createAuth = (ctx: GenericCtx) =>
	betterAuth(createAuthOptions(ctx));

// ---------------------------------------------------------------------------
// Client API helpers
// ---------------------------------------------------------------------------

export const { getAuthUser } = authComponent.clientApi();

/**
 * Get the current authenticated user (or null if not signed in).
 * Used from the client via subscription.
 *
 * Uses `queryGeneric` instead of the typed `query` from `_generated/server`
 * because Better Auth expects `GenericCtx<GenericDataModel>`, and our typed
 * query ctx (with specific DataModel) isn't assignable to the generic one.
 */
export const getCurrentUser = queryGeneric({
	args: {},
	returns: undefined,
	handler: async (ctx) => {
		return authComponent.safeGetAuthUser(ctx);
	},
});
