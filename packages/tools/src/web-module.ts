// MeteModule entry of tools-web (docs/06-kernel-and-modules.md): web.fetch@1 over HTTP.
import { type ModuleManifest, ok, type ToolAdapter } from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import { fetchTool, type WebDeps } from "./application/web-fetch.js";
import { policyOf } from "./module.js";

/** What tools-web may be given; tests pass a fake fetch, nothing else reaches the network. */
export type ToolsWebOptions = { readonly fetch?: typeof fetch };

const WEB_MANIFEST: ModuleManifest = {
	id: "tools-web",
	version: "0.0.0",
	displayName: "Web tools",
	class: "optional",
	trust: "core",
	provides: ["web.fetch@1"],
	requires: ["policy.check@1"],
	optional: ["mcp.tools@1"],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["net"],
};

/** The tools-web module: web.fetch@1 now; web.search@1 comes with its HTTP adapters. */
export const createToolsWebModule = (
	opts: ToolsWebOptions = {},
): MeteModule => ({
	manifest: WEB_MANIFEST,
	async activate(ctx) {
		const deps: WebDeps = {
			adapterId: WEB_MANIFEST.id,
			policy: policyOf(ctx.capabilities),
			fetch: opts.fetch ?? fetch,
		};
		const impl: ToolAdapter<unknown, unknown> = {
			run: (input, c) => fetchTool(deps, input, c),
		};
		ctx.disposables.add(
			ctx.capabilities.provide("web.fetch@1", {
				id: WEB_MANIFEST.id,
				trust: "core",
				features: [],
				impl,
			}),
		);
		return ok(undefined);
	},
	async deactivate() {},
});
