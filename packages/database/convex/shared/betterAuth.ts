import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { admin, anonymous } from "better-auth/plugins";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";
import authSchema from "../betterAuth/schema";

export const authComponent = createClient<DataModel, typeof authSchema>(
	components.betterAuth,
	{
		local: {
			schema: authSchema,
		},
	},
);

export const createAuthOptions = (
	ctx: GenericCtx<DataModel>,
	{ optionsOnly } = { optionsOnly: false },
): BetterAuthOptions => {
	const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

	return {
		logger: {
			disabled: optionsOnly,
		},
		trustedOrigins: [siteUrl, "http://localhost:3000"],
		advanced: {
			disableCSRFCheck: true,
		},
		account: {
			accountLinking: {
				enabled: true,
				allowDifferentEmails: true,
			},
		},
		baseURL: siteUrl,
		database: authComponent.adapter(ctx),
		secret: (() => {
			const secret = process.env.BETTER_AUTH_SECRET;
			if (!secret) {
				throw new Error("BETTER_AUTH_SECRET environment variable is required");
			}
			return secret;
		})(),
		user: {
			additionalFields: {
				role: {
					type: "string",
					required: false,
				},
			},
		},
		socialProviders: {
			...(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET
				? {
						discord: {
							clientId: process.env.DISCORD_CLIENT_ID,
							clientSecret: process.env.DISCORD_CLIENT_SECRET,
							scope: ["identify", "email"],
						},
					}
				: {}),
			...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
				? {
						github: {
							clientId: process.env.GITHUB_CLIENT_ID,
							clientSecret: process.env.GITHUB_CLIENT_SECRET,
							scope: [],
						},
					}
				: {}),
		},
		plugins: [
			convex({ authConfig }),
			crossDomain({
				siteUrl,
			}),
			anonymous({
				disableDeleteAnonymousUser: true,
			}),
			admin({
				impersonationSessionDuration: 60 * 60,
			}),
		],
	} satisfies BetterAuthOptions;
};

export const createAuth = (
	ctx: GenericCtx<DataModel>,
	{ optionsOnly } = { optionsOnly: false },
): ReturnType<typeof betterAuth> => {
	return betterAuth(createAuthOptions(ctx, { optionsOnly }));
};
