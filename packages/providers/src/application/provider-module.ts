import {
	type CapabilityRef,
	err,
	type ModuleManifest,
	ok,
	type ProviderAdapter,
} from "@mete/contracts";
import type { Disposable, MeteModule, ModuleError } from "@mete/kernel";
import {
	type ModelData,
	ModelDataSchema,
	type ModelRow,
	mergeModelData,
} from "../domain/model-data.js";
import { loadShippedModels } from "../infrastructure/model-data.js";

// One provider module (docs/06 table, docs/09 API keys): the key from the keychain,
// the model rows, and one adapter provided under every capability it serves.

/** What a provider adapter is built from. */
export type ProviderEnv = {
	readonly apiKey: string;
	readonly models: Readonly<Record<string, ModelRow>>;
	readonly fetch?: typeof globalThis.fetch;
	readonly now: () => number;
};

/** One provider: its module id, the refs it provides and how its adapter is built. */
export type ProviderDefinition = {
	readonly providerId: string;
	readonly moduleId: string;
	readonly displayName: string;
	readonly provides: readonly CapabilityRef[];
	readonly build: (env: ProviderEnv) => ProviderAdapter;
};

/** Test hooks; without `shippedModels` the module reads data/models.yaml. */
export type ProviderModuleOptions = {
	readonly shippedModels?: ModelData;
	readonly fetch?: typeof globalThis.fetch;
	readonly now?: () => number;
};

const manifestOf = (def: ProviderDefinition): ModuleManifest => ({
	id: def.moduleId,
	version: "0.0.0",
	displayName: def.displayName,
	class: "optional",
	trust: "first-party",
	provides: [...def.provides],
	requires: [],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["net", "secrets"],
});

/** The keychain account of a provider's API key (docs/09). */
export const apiKeyName = (providerId: string) =>
	`providers/${providerId}/apiKey`;

/** Creates the module for one provider definition. */
export const createProviderModule = (
	def: ProviderDefinition,
	opts: ProviderModuleOptions = {},
): MeteModule => {
	const manifest = manifestOf(def);
	const failed = (message: string): ModuleError => ({
		code: "activation_failed",
		moduleId: manifest.id,
		message,
	});
	let created: Disposable[] = [];
	return {
		manifest,
		async activate(ctx) {
			if (!ctx.secrets)
				return err(failed("the secrets permission was not granted"));
			const key = await ctx.secrets.get(apiKeyName(def.providerId));
			if (!key.ok) return err(failed(key.error.message));
			if (!key.value) return err(failed("no API key"));
			const user = ctx.config.get("models", ModelDataSchema);
			if (!user.ok) {
				const { file, path, reason } = user.error;
				return err(failed(`${file} ${path}: ${reason}`));
			}
			const shipped = opts.shippedModels ?? (await loadShippedModels());
			const models = mergeModelData(shipped, user.value)[def.providerId] ?? {};
			const adapter = def.build({
				apiKey: key.value,
				models,
				now: opts.now ?? Date.now,
				...(opts.fetch ? { fetch: opts.fetch } : {}),
			});
			// Bindings and quota name a provider by its provider id (docs/10, bindings.yaml).
			const base = {
				id: def.providerId,
				trust: manifest.trust,
				features: [],
			} as const;
			created = def.provides.map((ref) =>
				ctx.capabilities.provide(ref, { ...base, impl: adapter }),
			);
			for (const d of created) ctx.disposables.add(d);
			return ok(undefined);
		},
		async deactivate() {
			for (const d of created.splice(0)) d.dispose();
		},
	};
};
