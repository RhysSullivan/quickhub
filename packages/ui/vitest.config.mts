import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "happy-dom",
		env: {
			CONVEX_OTEL_ENABLED: "true",
			NEXT_PUBLIC_CONVEX_URL: "https://test.convex.cloud",
		},
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},
		server: {
			deps: {
				inline: ["@packages/convex-test"],
			},
		},
	},
});
