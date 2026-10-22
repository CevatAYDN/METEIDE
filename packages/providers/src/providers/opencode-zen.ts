import { ok, type ProviderAdapter } from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import {
	createProviderModule,
	type ProviderDefinition,
	type ProviderEnv,
	type ProviderModuleOptions,
} from "../application/provider-module.js";
import { ZEN_BASE_URL, ZEN_MODELS_URL, ZEN_QUOTA } from "../defaults.js";
import { chatModels, privacyFromRows } from "../domain/model-data.js";
import { observeMinute429 } from "../domain/observe.js";
import { listModelIds } from "../infrastructure/model-list.js";
import { createOpenAIChat } from "../infrastructure/openai-chat.js";

// OpenCode Zen (docs/09, provider facts): chat completions, ids-only model list,
// privacy per model from models.yaml.

const ID = "opencode-zen";

const build = (env: ProviderEnv): ProviderAdapter => {
	const fetch = env.fetch ? { fetch: env.fetch } : {};
	const { chat } = createOpenAIChat({
		name: ID,
		baseURL: ZEN_BASE_URL,
		apiKey: env.apiKey,
		...fetch,
	});
	return {
		id: ID,
		format: "openai-chat",
		async listModels(signal) {
			const ids = await listModelIds(ZEN_MODELS_URL, env.apiKey, signal, {
				fetch: env.fetch,
			});
			return ids.ok ? ok(chatModels(ID, ids.value, env.models)) : ids;
		},
		chat,
		quotaUnits: () => [...ZEN_QUOTA],
		observe: (status, headers) => observeMinute429(status, headers, env.now()),
		privacy: privacyFromRows(env.models),
	};
};

/** The provider-opencode-zen definition. */
export const OPENCODE_ZEN: ProviderDefinition = {
	providerId: ID,
	moduleId: "provider-opencode-zen",
	displayName: "OpenCode Zen",
	provides: ["provider.chat@2"],
	build,
};

/** Creates the provider-opencode-zen module. */
export const createOpenCodeZenModule = (
	opts?: ProviderModuleOptions,
): MeteModule => createProviderModule(OPENCODE_ZEN, opts);
