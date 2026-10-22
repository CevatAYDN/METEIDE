// The registry module (docs/06, docs/10 Registries): registry.search@1 over the official MCP registry.
import {
	type ModuleManifest,
	ok,
	type PolicyCheckAdapter,
} from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import { officialRegistry } from "./application/registry-search.js";

/** What the registry module is given; tests pass a fake fetch, so nothing reaches the network. */
export type RegistryOptions = { readonly fetch?: typeof fetch };

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
	permissions: ["net"],
};

// shortcut: the METE registry and the local folder adapters wait until their repository and folder are chosen (docs/10).
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
		return Promise.resolve(ok(undefined));
	},
	deactivate: () => Promise.resolve(),
});
