// The registry module (docs/06, docs/10 Registries): registry.search@1 over the official MCP registry and the local one.
import {
	type ModuleManifest,
	ok,
	type PolicyCheckAdapter,
} from "@mete/contracts";
import type { MeteModule, ModuleContext } from "@mete/kernel";
import { localRegistry } from "./application/local-registry.js";
import {
	officialRegistry,
	type RegistryDeps,
} from "./application/registry-search.js";
import { officialSetup } from "./application/registry-setup.js";

/** What the registry module is given; tests pass a fake fetch, so nothing reaches the network. */
/** `globalDir` holds the local registry (`registry/index.json`); without it only the official one is provided. */
export type RegistryOptions = {
	readonly fetch?: typeof fetch;
	readonly globalDir?: string;
};

const MANIFEST: ModuleManifest = {
	id: "registry",
	version: "0.0.0",
	displayName: "Registry search",
	class: "optional",
	trust: "core",
	provides: ["registry.search@1", "registry.setup@1"],
	requires: ["policy.check@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["net", "fs.read"],
};

const provideOfficial = (ctx: ModuleContext, deps: RegistryDeps) => {
	for (const [ref, impl] of [
		["registry.search@1", officialRegistry(deps)],
		["registry.setup@1", officialSetup(deps)],
	] as const) {
		ctx.disposables.add(
			ctx.capabilities.provide(ref, {
				id: deps.adapterId,
				trust: "core",
				features: [],
				impl,
			}),
		);
	}
};

// shortcut: the METE registry adapter waits for its repository (Phase 7); it will read the same index.json shape as the local one (docs/10).
export const createRegistryModule = (
	opts: RegistryOptions = {},
): MeteModule => ({
	manifest: MANIFEST,
	activate(ctx) {
		const policy = (): PolicyCheckAdapter | undefined => {
			const r = ctx.capabilities.resolve<PolicyCheckAdapter>("policy.check@1");
			return r.ok ? r.value[0].impl : undefined;
		};
		provideOfficial(ctx, {
			adapterId: "official-mcp-registry",
			policy,
			fetch: opts.fetch ?? fetch,
		});
		if (opts.globalDir)
			ctx.disposables.add(
				ctx.capabilities.provide("registry.search@1", {
					id: "local-registry",
					trust: "core",
					features: [],
					impl: localRegistry(opts.globalDir),
				}),
			);
		return Promise.resolve(ok(undefined));
	},
	deactivate: () => Promise.resolve(),
});
