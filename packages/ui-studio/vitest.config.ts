import { defineConfig } from "vitest/config";

// Coverage targets from docs/15-testing-build-release.md.
export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["src/**"],
			// The PixiJS stage needs WebGL and a canvas, which Node lacks; it is checked in the window,
			// like the Theia glue of ui-theia.
			exclude: ["src/index.ts", "src/infrastructure/stage.ts"],
			thresholds: { lines: 75, "src/domain/**": { lines: 90 } },
		},
	},
});
