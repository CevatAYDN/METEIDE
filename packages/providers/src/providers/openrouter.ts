import {
	ok,
	type Privacy,
	type ProviderAdapter,
	type QuotaObservation,
} from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import {
	createProviderModule,
	type ProviderDefinition,
	type ProviderEnv,
	type ProviderModuleOptions,
} from "../application/provider-module.js";
import {
	OPENROUTER_BASE_URL,
	OPENROUTER_DAILY_LIMIT_FLOOR,
	OPENROUTER_QUOTA,
} from "../defaults.js";
import { withRow } from "../domain/model-data.js";
import { retryAfter } from "../domain/retry-after.js";
import { createOpenAIChat } from "../infrastructure/openai-chat.js";
import { listOpenRouterModels } from "../infrastructure/openrouter-models.js";

// OpenRouter (docs/09, provider facts and observe() rules) through @ai-sdk/openai-compatible (ADR-039).

const ID = "openrouter";

// shortcut: data_collection is always "deny"; read the user's opt-in once Settings has one (docs/09 Privacy).
const ROUTING = { provider: { data_collection: "deny" } };
const PRIVACY: Privacy = { trains: false, logs: "unknown", publishes: false };

// Only OpenRouter's own limits carry X-RateLimit-*; an upstream provider's 429 closes nothing.
const observe = (
	status: number,
	headers: Headers,
	now: number,
): QuotaObservation[] => {
	const limit = Number(headers.get("x-ratelimit-limit") ?? Number.NaN);
	if (status !== 429 || !Number.isFinite(limit) || limit <= 0) return [];
	const resetsAt = retryAfter(headers, now);
	return [
		{
			unit:
				limit >= OPENROUTER_DAILY_LIMIT_FLOOR
					? "requests_per_day"
					: "requests_per_minute",
			limit,
			exhausted: true,
			...(resetsAt === undefined ? {} : { resetsAt }),
		},
	];
};

const build = (env: ProviderEnv): ProviderAdapter => {
	const fetch = env.fetch ? { fetch: env.fetch } : {};
	const { chat } = createOpenAIChat({
		name: ID,
		baseURL: OPENROUTER_BASE_URL,
		apiKey: env.apiKey,
		extraBody: ROUTING,
		...fetch,
	});
	return {
		id: ID,
		format: "openai-chat",
		async listModels(signal) {
			const listed = await listOpenRouterModels(
				`${OPENROUTER_BASE_URL}/models`,
				env.apiKey,
				signal,
				{ now: env.now(), fetch: env.fetch },
			);
			if (!listed.ok) return listed;
			const row = (id: string) =>
				Object.hasOwn(env.models, id) ? env.models[id] : undefined;
			return ok(listed.value.map((m) => withRow(m, row(m.id))));
		},
		chat,
		quotaUnits: () => [...OPENROUTER_QUOTA],
		observe: (status, headers) => observe(status, headers, env.now()),
		privacy: () => PRIVACY,
	};
};

/** The provider-openrouter definition. */
export const OPENROUTER: ProviderDefinition = {
	providerId: ID,
	moduleId: "provider-openrouter",
	displayName: "OpenRouter",
	provides: ["provider.chat@2"],
	build,
};

/** Creates the provider-openrouter module. */
export const createOpenRouterModule = (
	opts?: ProviderModuleOptions,
): MeteModule => createProviderModule(OPENROUTER, opts);
