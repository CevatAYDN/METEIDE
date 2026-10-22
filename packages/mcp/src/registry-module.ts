// The registry module (docs/06, docs/10 Registries): registry.search@1 over the official MCP registry and the local one.
import {
	type ModuleManifest,
	ok,
	type PolicyCheckAdapter,
} from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import { localRegistry } from "./application/local-registry.js";
import { officialRegistry } from "./application/registry-search.js";

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
	provides: ["registry.search@1"],
	requires: ["policy.check@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["net", "fs.read"],
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
		const impl = officialRegistry({
			adapterId: "official-mcp-registry",
			policy,
			fetch: opts.fetch ?? fetch,
		});
		ctx.disposables.add(
			ctx.capabilities.provide("registry.search@1", {
				id: "official-mcp-registry",
				trust: "core",
				features: [],
				impl,
			}),
		);
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
