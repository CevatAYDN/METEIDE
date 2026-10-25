import { defineConfig } from "vitest/config";

// Coverage targets from docs/15-testing-build-release.md.
export default defineConfig({
	test: {
		// These tests run real git and load the page parsers on their first fetch; under a fully
		// parallel `pnpm test` on Windows, one such test can outlast Vitest's 5 s default.
		testTimeout: 20_000,
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: ["src/index.ts"],
			thresholds: { lines: 75, "src/domain/**": { lines: 90 } },
		},
	},
});
