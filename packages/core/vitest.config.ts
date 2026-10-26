import { defineConfig } from "vitest/config";

// Coverage targets from docs/15-testing-build-release.md.
export default defineConfig({
	test: {
		// A test that starts a server or reads real folders can outlast Vitest's 5 s default under a
		// fully parallel `pnpm test` on Windows (docs/15).
		testTimeout: 20_000,
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: ["src/index.ts"],
			thresholds: { lines: 75, "src/domain/**": { lines: 90 } },
		},
	},
});
