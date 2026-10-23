import type { MeteModule } from "@mete/kernel";
import { keyedProvider } from "../application/keyed-provider.js";
import {
	createProviderModule,
	type ProviderModuleOptions,
} from "../application/provider-module.js";
import {
	GROQ_BASE_URL,
	GROQ_MODELS_URL,
	GROQ_TOKEN_LIMIT_HEADER,
} from "../defaults.js";

// Groq (docs/09, provider facts): OpenAI-compatible chat, an ids-only model list, free ids and
// privacy per model from models.yaml, and its tokens-per-minute limit learned from a refused request
// (a 413 names it in x-ratelimit-limit-tokens; ADR-056).

/** The provider-groq definition. */
export const GROQ = keyedProvider({
	providerId: "groq",
	displayName: "Groq",
	baseURL: GROQ_BASE_URL,
	modelsURL: GROQ_MODELS_URL,
	tokenLimitHeader: GROQ_TOKEN_LIMIT_HEADER,
});

/** Creates the provider-groq module. */
export const createGroqModule = (opts?: ProviderModuleOptions): MeteModule =>
	createProviderModule(GROQ, opts);
