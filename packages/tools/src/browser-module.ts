// MeteModule entry of browser (docs/06-kernel-and-modules.md): browser.screenshot@1 and
// seo.audit@1. The module runs in process; every call drives Chromium in a child process.
import {
	type CapabilityRef,
	type ModuleManifest,
	ok,
	type ToolAdapter,
} from "@mete/contracts";
import type { MeteModule, ModuleContext } from "@mete/kernel";
import {
	auditTool,
	type BrowserDeps,
	screenshotTool,
} from "./application/browser.js";
import {
	type Chromium,
	playwrightChromium,
} from "./infrastructure/chromium.js";
import { realTarget } from "./infrastructure/files.js";
import { forkRunner, type RunBrowser } from "./infrastructure/runner.js";
import { policyOf } from "./module.js";

/** What browser is given; tests pass a fake runner and Chromium, so no browser starts or installs. */
export type BrowserOptions = {
	readonly workspaceDir: string;
	readonly run?: RunBrowser;
	readonly chromium?: Chromium;
};

const MANIFEST: ModuleManifest = {
	id: "browser",
	version: "0.0.0",
	displayName: "Browser",
	class: "optional",
	trust: "core",
	provides: ["browser.screenshot@1", "seo.audit@1"],
	// shortcut: runtime.ensure@1 does not cover Chromium (docs/06, browser row); Playwright installs it itself (docs/10).
	requires: ["policy.check@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["net", "fs.write", "shell"],
};

const provide = (
	ctx: ModuleContext,
	ref: CapabilityRef,
	impl: ToolAdapter<unknown, unknown>,
) =>
	ctx.disposables.add(
		ctx.capabilities.provide(ref, {
			id: MANIFEST.id,
			trust: "core",
			features: [],
			impl,
		}),
	);

/** The browser module: screenshots and Lighthouse audits of public pages. */
export const createBrowserModule = (opts: BrowserOptions): MeteModule => ({
	manifest: MANIFEST,
	async activate(ctx) {
		const deps: BrowserDeps = {
			adapterId: MANIFEST.id,
			workspaceDir: await realTarget(opts.workspaceDir),
			policy: policyOf(ctx.capabilities),
			run: opts.run ?? forkRunner,
			chromium: opts.chromium ?? playwrightChromium(),
		};
		provide(ctx, "browser.screenshot@1", {
			run: (input, c) => screenshotTool(deps, input, c),
		});
		provide(ctx, "seo.audit@1", {
			run: (input, c) => auditTool(deps, input, c),
		});
		return ok(undefined);
	},
	async deactivate() {},
});
