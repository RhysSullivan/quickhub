import { withSentryConfig } from "@sentry/nextjs";
import createWithVercelToolbar from "@vercel/toolbar/plugins/next";
import type { NextConfig } from "next";

const withVercelToolbar = createWithVercelToolbar();

// Public production defaults — these are safe to hard-code because they are
// already shipped in the client-side JS bundle (public Convex URLs, public
// PostHog project key, GitHub App slug). Override via env vars when needed.
const PUBLIC_DEFAULTS = {
	CONVEX_URL: "https://descriptive-caiman-974.convex.cloud",
	CONVEX_SITE_URL: "https://descriptive-caiman-974.convex.site",
	GITHUB_APP_SLUG: "fastergh",
	POSTHOG_KEY: "phc_tTEM4loHjBhSHn6kWKQp92dEA1sNc5UQiQssccS7M7M",
	POSTHOG_HOST: "https://us.i.posthog.com",
} as const;

const nextConfig: NextConfig = {
	reactStrictMode: true,
	cacheComponents: true,
	typescript: {
		ignoreBuildErrors: true,
	},
	// Expose server-side env vars to the client bundle so we don't
	// need separate NEXT_PUBLIC_ copies of the same values.
	env: {
		NEXT_PUBLIC_CONVEX_URL:
			process.env.CONVEX_URL ?? PUBLIC_DEFAULTS.CONVEX_URL,
		NEXT_PUBLIC_CONVEX_SITE_URL:
			process.env.CONVEX_SITE_URL ?? PUBLIC_DEFAULTS.CONVEX_SITE_URL,
		NEXT_PUBLIC_GITHUB_APP_SLUG:
			process.env.GITHUB_APP_SLUG ?? PUBLIC_DEFAULTS.GITHUB_APP_SLUG,
		NEXT_PUBLIC_POSTHOG_KEY:
			process.env.POSTHOG_KEY ?? PUBLIC_DEFAULTS.POSTHOG_KEY,
		NEXT_PUBLIC_POSTHOG_HOST:
			process.env.POSTHOG_HOST ?? PUBLIC_DEFAULTS.POSTHOG_HOST,
	},
	transpilePackages: ["@packages/ui", "@packages/database"],
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "cdn.discordapp.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
		],
	},
	allowedDevOrigins: ["wsl-dev.tail5665af.ts.net"],
	reactCompiler: false,
	experimental: {
		turbopackFileSystemCacheForDev: true,
	},
};

export default withSentryConfig(withVercelToolbar(nextConfig), {
	org: process.env.SENTRY_ORG,
	project: process.env.SENTRY_PROJECT,
	silent: !process.env.CI,
	widenClientFileUpload: true,
	disableLogger: true,
	automaticVercelMonitors: true,
	sourcemaps: {
		deleteSourcemapsAfterUpload: false,
	},
	reactComponentAnnotation: {
		enabled: true,
	},
});
