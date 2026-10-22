import { ok, type Privacy, type ProviderAdapter } from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import {
	createProviderModule,
	type ProviderDefinition,
	type ProviderEnv,
	type ProviderModuleOptions,
} from "../application/provider-module.js";
import {
	NVIDIA_BASE_URL,
	NVIDIA_QUOTA,
	NVIDIA_RERANK_URL,
} from "../defaults.js";
import { chatModels } from "../domain/model-data.js";
import { observeMinute429 } from "../domain/observe.js";
import { listModelIds } from "../infrastructure/model-list.js";
import {
	nvidiaEmbed,
	nvidiaRerank,
} from "../infrastructure/nvidia-retrieval.js";
import { createOpenAIChat } from "../infrastructure/openai-chat.js";

// NVIDIA Build (docs/09, provider facts): chat, embeddings and rerank on the trial API.

const ID = "nvidia";

// API Trial Terms of Service, section 3.3 (iv): content is collected to improve NVIDIA's models.
const PRIVACY: Privacy = { trains: true, logs: true, publishes: false };

const build = (env: ProviderEnv): ProviderAdapter => {
	const call = { apiKey: env.apiKey, fetch: env.fetch };
	const { chat } = createOpenAIChat({
		name: ID,
		baseURL: NVIDIA_BASE_URL,
		apiKey: env.apiKey,
		...(env.fetch ? { fetch: env.fetch } : {}),
	});
	return {
		id: ID,
		format: "openai-chat",
		async listModels(signal) {
			const ids = await listModelIds(
				`${NVIDIA_BASE_URL}/models`,
				env.apiKey,
				signal,
				{
					fetch: env.fetch,
				},
			);
			return ids.ok ? ok(chatModels(ID, ids.value, env.models)) : ids;
		},
		chat,
		embed: (req, signal) =>
			nvidiaEmbed(`${NVIDIA_BASE_URL}/embeddings`, req, signal, call),
		rerank: (req, signal) =>
			nvidiaRerank(NVIDIA_RERANK_URL(req.model), req, signal, call),
		quotaUnits: () => [...NVIDIA_QUOTA],
		observe: (status, headers) => observeMinute429(status, headers, env.now()),
		privacy: () => PRIVACY,
	};
};

/** The provider-nvidia definition. */
export const NVIDIA: ProviderDefinition = {
	providerId: ID,
	moduleId: "provider-nvidia",
	displayName: "NVIDIA Build",
	provides: ["provider.chat@2", "provider.embed@1", "provider.rerank@1"],
	build,
};

/** Creates the provider-nvidia module. */
export const createNvidiaModule = (opts?: ProviderModuleOptions): MeteModule =>
	createProviderModule(NVIDIA, opts);
