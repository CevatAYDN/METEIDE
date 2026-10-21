import { defineConfig } from "vitest/config";

// Coverage targets from docs/15-testing-build-release.md.
export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: ["src/index.ts"],
			thresholds: { lines: 75, "src/domain/**": { lines: 90 } },
		},
	},
});
