import {
	type CustomEndpoint,
	err,
	type ModuleManifest,
	ok,
	type ProviderAdapter,
	ProvidersConfigSchema,
} from "@mete/contracts";
import type {
	Disposable,
	MeteModule,
	ModuleContext,
	ModuleError,
} from "@mete/kernel";
import {
	apiKeyName,
	type ProviderModuleOptions,
} from "../application/provider-module.js";
import { customQuota } from "../defaults.js";
import {
	chatModels,
	ModelDataSchema,
	type ModelRow,
	privacyFromRows,
} from "../domain/model-data.js";
import { observeMinute429 } from "../domain/observe.js";
import { listModelIds } from "../infrastructure/model-list.js";
import { createOpenAIChat } from "../infrastructure/openai-chat.js";

// provider-custom (docs/09, API keys): one adapter per endpoint in the `providers:`
// section, registered as custom:<slug>; an endpoint without its key is skipped.

const MANIFEST: ModuleManifest = {
	id: "provider-custom",
	version: "0.0.0",
	displayName: "Custom endpoints",
	class: "optional",
	trust: "first-party",
	provides: ["provider.chat@1", "provider.embed@1"],
	requires: [],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["net", "secrets"],
};

type Env = {
	readonly apiKey: string;
	readonly models: Readonly<Record<string, ModelRow>>;
	readonly fetch: typeof globalThis.fetch | undefined;
	readonly now: () => number;
};

const buildCustom = (ep: CustomEndpoint, env: Env): ProviderAdapter => {
	const id = `custom:${ep.slug}`;
	const { chat, embed } = createOpenAIChat({
		name: id,
		baseURL: ep.baseUrl,
		apiKey: env.apiKey,
		headers: ep.headers,
		...(env.fetch ? { fetch: env.fetch } : {}),
	});
	return {
		id,
		format: "openai-chat",
		async listModels(signal) {
			const ids = await listModelIds(
				`${ep.baseUrl}/models`,
				env.apiKey,
				signal,
				{
					fetch: env.fetch,
					headers: ep.headers,
				},
			);
			return ids.ok ? ok(chatModels(id, ids.value, env.models)) : ids;
		},
		chat,
		embed,
		quotaUnits: () => customQuota(id),
		observe: (status, headers) => observeMinute429(status, headers, env.now()),
		privacy: privacyFromRows(env.models),
	};
};

const failed = (message: string): ModuleError => ({
	code: "activation_failed",
	moduleId: MANIFEST.id,
	message,
});

const where = (e: { file: string; path: string; reason: string }) =>
	`${e.file} ${e.path}: ${e.reason}`;

type Key = { readonly key: string } | { readonly skip: string };

// The endpoint's key, or why the endpoint is skipped.
const keyFor = async (ctx: ModuleContext, ep: CustomEndpoint): Promise<Key> => {
	// shortcut: only openai-chat endpoints are served; add anthropic-messages and google-gemini next.
	if (ep.format !== "openai-chat")
		return { skip: `the ${ep.format} format is not served yet` };
	if (!ctx.secrets) return { skip: "the secrets permission was not granted" };
	const key = await ctx.secrets.get(apiKeyName(`custom:${ep.slug}`));
	if (!key.ok) return { skip: key.error.message };
	return key.value ? { key: key.value } : { skip: "no API key" };
};

const provideAll = (ctx: ModuleContext, id: string, adapter: ProviderAdapter) =>
	MANIFEST.provides.map((ref) =>
		ctx.capabilities.provide(ref, {
			id,
			trust: MANIFEST.trust,
			features: [],
			impl: adapter,
		}),
	);

/** Creates the provider-custom module. */
export const createCustomModule = (
	opts: ProviderModuleOptions = {},
): MeteModule => {
	const created: Disposable[] = [];
	const activate = async (ctx: ModuleContext) => {
		const config = ctx.config.get("providers", ProvidersConfigSchema);
		if (!config.ok) return err(failed(where(config.error)));
		const rows = ctx.config.get("models", ModelDataSchema);
		if (!rows.ok) return err(failed(where(rows.error)));
		for (const ep of config.value.custom) {
			const id = `custom:${ep.slug}`;
			const got = await keyFor(ctx, ep);
			if ("skip" in got) {
				ctx.logger.warn(
					{ endpoint: id, reason: got.skip },
					"custom endpoint skipped",
				);
				continue;
			}
			const adapter = buildCustom(ep, {
				apiKey: got.key,
				models: rows.value[id] ?? {},
				fetch: opts.fetch,
				now: opts.now ?? Date.now,
			});
			created.push(...provideAll(ctx, id, adapter));
		}
		for (const d of created) ctx.disposables.add(d);
		return ok(undefined);
	};
	return {
		manifest: MANIFEST,
		activate,
		async deactivate() {
			for (const d of created.splice(0)) d.dispose();
		},
	};
};
