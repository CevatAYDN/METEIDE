import { defineConfig } from "vitest/config";

// Coverage targets from docs/15-testing-build-release.md. The Theia bindings (widgets, contributions,
// modules, the RPC service, the commands that need Theia's services) run only inside Theia, so the
// desktop end-to-end tests measure them (docs/15); the logic they call lives in application/.
export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: [
				"src/index.ts",
				"src/infrastructure/*-contribution.ts",
				"src/infrastructure/*-widget.tsx",
				"src/infrastructure/*-view.tsx",
				"src/infrastructure/backend-module.ts",
				"src/infrastructure/daemon-service.ts",
				"src/infrastructure/artifact-command.ts",
				"src/infrastructure/localization.ts",
			],
			thresholds: { lines: 75, "src/domain/**": { lines: 90 } },
		},
	},
});
