import { defineConfig } from "vitest/config";

export default defineConfig({
	esbuild: {
		jsx: "automatic",
	},
	test: {
		environment: "happy-dom",
		env: {
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
