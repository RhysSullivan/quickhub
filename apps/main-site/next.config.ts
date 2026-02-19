import { withSentryConfig } from "@sentry/nextjs";
import createWithVercelToolbar from "@vercel/toolbar/plugins/next";
import type { NextConfig } from "next";

const withVercelToolbar = createWithVercelToolbar();

const nextConfig: NextConfig = {
	reactStrictMode: true,
	cacheComponents: true,
	typescript: {
		ignoreBuildErrors: true,
	},
	// Expose server-side env vars to the client bundle so we don't
	// need separate NEXT_PUBLIC_ copies of the same values.
	env: {
		NEXT_PUBLIC_CONVEX_URL: process.env.CONVEX_URL,
		NEXT_PUBLIC_CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
		NEXT_PUBLIC_GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
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
