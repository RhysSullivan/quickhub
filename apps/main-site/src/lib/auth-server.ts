import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

// Public production defaults — same values are shipped in the client bundle.
const CONVEX_URL =
	process.env.CONVEX_URL ?? "https://descriptive-caiman-974.convex.cloud";
const CONVEX_SITE_URL =
	process.env.CONVEX_SITE_URL ?? "https://descriptive-caiman-974.convex.site";

export const {
	handler,
	preloadAuthQuery,
	isAuthenticated,
	getToken,
	fetchAuthQuery,
	fetchAuthMutation,
	fetchAuthAction,
} = convexBetterAuthNextJs({
	convexUrl: CONVEX_URL,
	convexSiteUrl: CONVEX_SITE_URL,
});
