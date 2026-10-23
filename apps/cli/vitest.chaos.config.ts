import { defineConfig } from "vitest/config";

// The chaos test of docs/15 runs at the release tier only: `pnpm test:chaos`.
export default defineConfig({
	test: { include: ["test/chaos.release.ts"] },
});
