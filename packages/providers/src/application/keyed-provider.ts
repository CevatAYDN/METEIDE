import { ok, type ProviderAdapter } from "@mete/contracts";
import { customQuota, tokenQuota } from "../defaults.js";
import { chatModels, privacyFromRows } from "../domain/model-data.js";
import { observeMinute429, observeTokenLimit } from "../domain/observe.js";
import { listModelIds } from "../infrastructure/model-list.js";
import { createOpenAIChat } from "../infrastructure/openai-chat.js";
import type { ProviderDefinition, ProviderEnv } from "./provider-module.js";

// A provider that serves free models over the OpenAI chat format for an API key (docs/09, provider
// facts): the model list gives ids only, the free ids and each model's privacy come from models.yaml,
// and the minute limit is learned from 429 responses, as for OpenCode Zen and custom endpoints; a
// provider that names its tokens-per-minute limit on a refused request also learns that (ADR-056).

/** Where one such provider answers. */
export type KeyedProvider = {
	readonly providerId: string;
	readonly displayName: string;
	readonly baseURL: string;
	readonly modelsURL: string;
	/** Removed from the front of every listed id, for a list that names models `models/<id>` while chat takes `<id>`. */
	readonly idPrefix?: string;
	/** The header of a refused request that names the tokens-per-minute limit, for a provider that sends one (ADR-056). */
	readonly tokenLimitHeader?: string;
};

const withoutPrefix = (id: string, prefix = "") =>
	id.startsWith(prefix) ? id.slice(prefix.length) : id;

const build =
	(spec: KeyedProvider) =>
	(env: ProviderEnv): ProviderAdapter => {
		const fetch = env.fetch ? { fetch: env.fetch } : {};
		const { chat } = createOpenAIChat({
			name: spec.providerId,
			baseURL: spec.baseURL,
			apiKey: env.apiKey,
			...fetch,
		});
		return {
			id: spec.providerId,
			format: "openai-chat",
			async listModels(signal) {
				const ids = await listModelIds(spec.modelsURL, env.apiKey, signal, {
					fetch: env.fetch,
				});
				return ids.ok
					? ok(
							chatModels(
								spec.providerId,
								ids.value.map((id) => withoutPrefix(id, spec.idPrefix)),
								env.models,
							),
						)
					: ids;
			},
			chat,
			quotaUnits: () => [
				...customQuota(spec.providerId),
				...(spec.tokenLimitHeader ? [tokenQuota(spec.providerId)] : []),
			],
			observe: (status, headers) => [
				...observeMinute429(status, headers, env.now()),
				...(spec.tokenLimitHeader
					? observeTokenLimit(status, headers, spec.tokenLimitHeader)
					: []),
			],
			privacy: privacyFromRows(env.models),
		};
	};

/** The provider definition for one such provider; its module id is `provider-<id>`. */
export const keyedProvider = (spec: KeyedProvider): ProviderDefinition => ({
	providerId: spec.providerId,
	moduleId: `provider-${spec.providerId}`,
	displayName: spec.displayName,
	provides: ["provider.chat@2"],
	build: build(spec),
});
