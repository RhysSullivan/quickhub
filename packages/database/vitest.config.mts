import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "edge-runtime",
		env: {
			CONVEX_OTEL_ENABLED: "true",
		},
		server: {
			deps: {
				inline: ["@packages/convex-test", "@packages/utils"],
			},
		},
		poolOptions: {
			threads: {
				singleThread: false,
			},
		},
		teardownTimeout: 10000,
	},
});
