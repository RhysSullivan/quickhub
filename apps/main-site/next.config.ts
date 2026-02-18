import { withSentryConfig } from "@sentry/nextjs";
import createWithVercelToolbar from "@vercel/toolbar/plugins/next";
import type { NextConfig } from "next";

const withVercelToolbar = createWithVercelToolbar();

const nextConfig: NextConfig = {
	typescript: {
		ignoreBuildErrors: true,
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
	reactCompiler: true,
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
