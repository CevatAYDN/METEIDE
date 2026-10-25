import { defineConfig } from "@playwright/test";

// The end-to-end tests of docs/15: Playwright drives the app's own Electron (never a Playwright
// browser), one worker, because the app holds the single-instance lock. Run with
// `pnpm --filter @mete/desktop test:e2e` after `pnpm build`, `bundle` and `download:plugins`.

// biome-ignore lint/style/noDefaultExport: Playwright reads its config as a default export
export default defineConfig({
	testDir: "e2e",
	testMatch: /.*\.e2e\.ts/,
	fullyParallel: false,
	workers: 1,
	timeout: 120_000,
	reporter: [["list"]],
});
