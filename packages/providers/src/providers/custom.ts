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
	embedModels,
	type ModelData,
	ModelDataSchema,
	type ModelRow,
	privacyFromRows,
	withRow,
} from "../domain/model-data.js";
import { observeMinute429 } from "../domain/observe.js";
import { listModelIds } from "../infrastructure/model-list.js";
import { createOpenAIChat } from "../infrastructure/openai-chat.js";
import {
	anthropicChat,
	type EndpointCall,
	googleChat,
	listAnthropicModels,
	listGoogleModels,
} from "../infrastructure/other-formats.js";

// provider-custom (docs/09, API keys): one adapter per endpoint in the `providers:`
// section, registered as custom:<slug>; an endpoint without its key is skipped.

const MANIFEST: ModuleManifest = {
	id: "provider-custom",
	version: "0.0.0",
	displayName: "Custom endpoints",
	class: "optional",
	trust: "first-party",
	provides: ["provider.chat@2", "provider.embed@2"],
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

type Served = Pick<
	ProviderAdapter,
	"chat" | "embed" | "embedModels" | "listModels"
>;

// What each format serves: openai-chat also embeds; the others list rich metadata
// that a user row may still override (docs/09, provider facts and API keys).
const serve = (ep: CustomEndpoint, env: Env, id: string): Served => {
	const call: EndpointCall = {
		providerId: id,
		baseUrl: ep.baseUrl,
		apiKey: env.apiKey,
		headers: ep.headers,
		fetch: env.fetch,
	};
	const rowsOver =
		(list: (s: AbortSignal) => ReturnType<ProviderAdapter["listModels"]>) =>
		async (signal: AbortSignal) => {
			const listed = await list(signal);
			if (!listed.ok) return listed;
			const row = (m: string) =>
				Object.hasOwn(env.models, m) ? env.models[m] : undefined;
			return ok(listed.value.map((m) => withRow(m, row(m.id))));
		};
	if (ep.format === "anthropic-messages")
		return {
			chat: anthropicChat(call),
			listModels: rowsOver((s) => listAnthropicModels(call, s)),
		};
	if (ep.format === "google-gemini")
		return {
			chat: googleChat(call),
			listModels: rowsOver((s) => listGoogleModels(call, s)),
		};
	return serveOpenAI(ep, env, id);
};

// An openai-chat endpoint chats, embeds and lists ids only, so rows give the facts.
const serveOpenAI = (ep: CustomEndpoint, env: Env, id: string): Served => {
	const { chat, embed } = createOpenAIChat({
		name: id,
		baseURL: ep.baseUrl,
		apiKey: env.apiKey,
		headers: ep.headers,
		...(env.fetch ? { fetch: env.fetch } : {}),
	});
	const listed = (signal: AbortSignal) =>
		listModelIds(`${ep.baseUrl}/models`, env.apiKey, signal, {
			fetch: env.fetch,
			headers: ep.headers,
		});
	return {
		chat,
		embed,
		async listModels(signal) {
			const ids = await listed(signal);
			return ids.ok ? ok(chatModels(id, ids.value, env.models)) : ids;
		},
		// Only the user's embed rows name embedding models here (docs/09, provider facts).
		async embedModels(signal) {
			const ids = await listed(signal);
			return ids.ok ? ok(embedModels(id, ids.value, env.models)) : ids;
		},
	};
};

const buildCustom = (ep: CustomEndpoint, env: Env): ProviderAdapter => {
	const id = `custom:${ep.slug}`;
	return {
		id,
		format: ep.format,
		...serve(ep, env, id),
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
	if (!ctx.secrets) return { skip: "the secrets permission was not granted" };
	const key = await ctx.secrets.get(apiKeyName(`custom:${ep.slug}`));
	if (!key.ok) return { skip: key.error.message };
	return key.value ? { key: key.value } : { skip: "no API key" };
};

// Only openai-chat endpoints embed (docs/09, API keys).
const provideAll = (ctx: ModuleContext, id: string, adapter: ProviderAdapter) =>
	MANIFEST.provides
		.filter((ref) => ref !== "provider.embed@2" || adapter.embedModels)
		.map((ref) =>
			ctx.capabilities.provide(ref, {
				id,
				trust: MANIFEST.trust,
				features: [],
				impl: adapter,
			}),
		);

// One endpoint's adapter; an endpoint without its key is skipped with a warning.
const provideEndpoint = async (
	ctx: ModuleContext,
	ep: CustomEndpoint,
	rows: ModelData,
	opts: ProviderModuleOptions,
): Promise<Disposable[]> => {
	const id = `custom:${ep.slug}`;
	const got = await keyFor(ctx, ep);
	if ("skip" in got) {
		ctx.logger.warn(
			{ endpoint: id, reason: got.skip },
			"custom endpoint skipped",
		);
		return [];
	}
	const adapter = buildCustom(ep, {
		apiKey: got.key,
		models: rows[id] ?? {},
		fetch: opts.fetch,
		now: opts.now ?? Date.now,
	});
	return provideAll(ctx, id, adapter);
};

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
		for (const ep of config.value.custom)
			created.push(...(await provideEndpoint(ctx, ep, rows.value, opts)));
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
