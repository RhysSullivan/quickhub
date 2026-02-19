import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { type GenericDataModel, queryGeneric } from "convex/server";
import { components } from "./_generated/api";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";

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
		local: {
			schema: authSchema,
		},
		verbose: false,
	},
);

// ---------------------------------------------------------------------------
// Auth options factory
// ---------------------------------------------------------------------------

const convexSiteUrl = process.env.CONVEX_SITE_URL;

export const createAuthOptions = (ctx: GenericCtx) => {
	const siteUrl = process.env.SITE_URL;

	return {
		baseURL: convexSiteUrl,
		trustedOrigins: siteUrl ? [siteUrl] : [],
		database: authComponent.adapter(ctx),
		account: {
			accountLinking: {
				enabled: true,
				allowDifferentEmails: true,
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
