import { defineConfig } from "vitest/config";

// Coverage targets from docs/15-testing-build-release.md.
export default defineConfig({
	test: {
		// Under a fully parallel test on Windows, tests creating temp repos can outlast 5 s.
		testTimeout: 20_000,
		coverage: {
			provider: "v8",
			include: ["src/**"],
			// bin.ts and terminal.ts only bind the process; the smoke run in the report covers them.
			exclude: ["src/index.ts", "src/bin.ts", "src/infrastructure/terminal.ts"],
			thresholds: { lines: 75, "src/domain/**": { lines: 90 } },
		},
	},
});
