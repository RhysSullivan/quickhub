import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

const CONVEX_URL =
	process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const CONVEX_SITE_URL =
	process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";

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
	jwtCache: {
		enabled: true,
		expirationToleranceSeconds: 60,
		isAuthError: (error) => {
			if (error instanceof Error) {
				const message = error.message.toLowerCase();
				return (
					message.includes("unauthenticated") ||
					message.includes("unauthorized") ||
					message.includes("not authenticated")
				);
			}
			return false;
		},
	},
});
