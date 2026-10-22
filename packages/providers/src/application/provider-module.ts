import {
	type CapabilityRef,
	err,
	type ModuleManifest,
	ok,
	PrivacyConfigSchema,
	type ProviderAdapter,
	type Result,
} from "@mete/contracts";
import type {
	Disposable,
	MeteModule,
	ModuleContext,
	ModuleError,
} from "@mete/kernel";
import { z } from "zod";
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
	/** The user's privacy opt-in, off in a sensitive workspace (docs/09, Privacy); an adapter may then drop its no-training routing. */
	readonly allowTraining?: boolean;
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

// The provider's key from the keychain; without one the module stays inactive.
const keyOf = async (
	ctx: ModuleContext,
	providerId: string,
): Promise<Result<string, string>> => {
	if (!ctx.secrets) return err("the secrets permission was not granted");
	const key = await ctx.secrets.get(apiKeyName(providerId));
	if (!key.ok) return err(key.error.message);
	return key.value ? ok(key.value) : err("no API key");
};

// The shipped rows with the user's models.yaml over them, for this provider.
const modelsOf = async (
	ctx: ModuleContext,
	providerId: string,
	opts: ProviderModuleOptions,
): Promise<Result<ProviderEnv["models"], string>> => {
	const user = ctx.config.get("models", ModelDataSchema);
	if (!user.ok) {
		const { file, path, reason } = user.error;
		return err(`${file} ${path}: ${reason}`);
	}
	const shipped = opts.shippedModels ?? (await loadShippedModels());
	return ok(mergeModelData(shipped, user.value)[providerId] ?? {});
};

// The kernel checks workspace.yaml's id; only its sensitivity is read here (docs/09, Privacy).
// shortcut: the gateway reads the same two settings; share the read when a third module needs it.
const WorkspaceSchema = z
	.looseObject({
		sensitivity: z.enum(["normal", "sensitive"]).default("normal"),
	})
	.prefault({});

// The user's opt-in to models that train on prompts, which a sensitive workspace never honours.
const trainingAllowed = (ctx: ModuleContext): Result<boolean, string> => {
	const privacy = ctx.config.get("privacy", PrivacyConfigSchema);
	if (!privacy.ok) {
		const { file, path, reason } = privacy.error;
		return err(`${file} ${path}: ${reason}`);
	}
	const workspace = ctx.config.get("workspace", WorkspaceSchema);
	if (!workspace.ok) {
		const { file, path, reason } = workspace.error;
		return err(`${file} ${path}: ${reason}`);
	}
	return ok(
		privacy.value.allowTraining && workspace.value.sensitivity !== "sensitive",
	);
};

// What the adapter is built from, read at activation: the key, the model rows and the privacy opt-in.
const inputsOf = async (
	ctx: ModuleContext,
	providerId: string,
	opts: ProviderModuleOptions,
): Promise<
	Result<Pick<ProviderEnv, "apiKey" | "models" | "allowTraining">, string>
> => {
	const key = await keyOf(ctx, providerId);
	if (!key.ok) return err(key.error);
	const models = await modelsOf(ctx, providerId, opts);
	if (!models.ok) return err(models.error);
	const training = trainingAllowed(ctx);
	if (!training.ok) return err(training.error);
	return ok({
		apiKey: key.value,
		models: models.value,
		allowTraining: training.value,
	});
};

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
			const inputs = await inputsOf(ctx, def.providerId, opts);
			if (!inputs.ok) return err(failed(inputs.error));
			const adapter = def.build({
				...inputs.value,
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
