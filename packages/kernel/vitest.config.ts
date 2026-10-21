import { defineConfig } from "vitest/config";

// Coverage targets from docs/15-testing-build-release.md.
export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["src/domain/**"],
			thresholds: { lines: 90 },
		},
	},
});
