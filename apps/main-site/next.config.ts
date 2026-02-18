import { withSentryConfig } from "@sentry/nextjs";
import createWithVercelToolbar from "@vercel/toolbar/plugins/next";
import type { NextConfig } from "next";

const withVercelToolbar = createWithVercelToolbar();

const nextConfig: NextConfig = {
	reactStrictMode: true,
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
	allowedDevOrigins: ["wsl-dev.tail5665af.ts.net"],
	reactCompiler: false,
	experimental: {
		turbopackFileSystemCacheForDev: false,
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
