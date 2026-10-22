// MeteModule entry of tools-web (docs/06-kernel-and-modules.md): web.fetch@1 and web.search@1 over HTTP.
import {
	type CapabilityRef,
	type ModuleManifest,
	ok,
	type ToolAdapter,
} from "@mete/contracts";
import type { MeteModule, ModuleContext } from "@mete/kernel";
import { fetchTool, type WebDeps } from "./application/web-fetch.js";
import { tavilySearch } from "./application/web-search.js";
import { policyOf } from "./module.js";

/** What tools-web may be given; tests pass a fake fetch, nothing else reaches the network. */
export type ToolsWebOptions = { readonly fetch?: typeof fetch };

const WEB_MANIFEST: ModuleManifest = {
	id: "tools-web",
	version: "0.0.0",
	displayName: "Web tools",
	class: "optional",
	trust: "core",
	provides: ["web.fetch@1", "web.search@1"],
	requires: ["policy.check@1"],
	optional: ["mcp.tools@1"],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["net", "secrets"],
};

// The Tavily adapter's own id, so bindings name it as docs/10 does (web.search@1: [exa-mcp, tavily]).
const TAVILY = "tavily";

/** The keychain account of a search provider's API key (docs/10), like providers/<id>/apiKey. */
export const searchKeyName = (id: string) => `search/${id}/apiKey`;

const provide = (
	ctx: ModuleContext,
	ref: CapabilityRef,
	impl: ToolAdapter<unknown, unknown>,
	id = WEB_MANIFEST.id,
) =>
	ctx.disposables.add(
		ctx.capabilities.provide(ref, {
			id,
			trust: "core",
			features: [],
			impl,
		}),
	);

// web.search@1 only with a key; without one the module still provides web.fetch@1 and warns.
const searchKey = async (ctx: ModuleContext) => {
	const key = await ctx.secrets?.get(searchKeyName(TAVILY));
	if (key?.ok && key.value) return key.value;
	const why =
		key && !key.ok ? key.error.message : "no Tavily key (mete key set tavily)";
	ctx.logger.warn(
		{ moduleId: WEB_MANIFEST.id, reason: why },
		"Tavily web.search@1 adapter not provided",
	);
	return undefined;
};

/** The tools-web module: web.fetch@1, and web.search@1 through Tavily when its key is set. */
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
		provide(ctx, "web.fetch@1", {
			run: (input, c) => fetchTool(deps, input, c),
		});
		const apiKey = await searchKey(ctx);
		if (apiKey)
			provide(
				ctx,
				"web.search@1",
				{
					run: (input, c) =>
						tavilySearch({ ...deps, adapterId: TAVILY, apiKey }, input, c),
				},
				TAVILY,
			);
		return ok(undefined);
	},
	async deactivate() {},
});
