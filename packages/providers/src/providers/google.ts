import type { MeteModule } from "@mete/kernel";
import { keyedProvider } from "../application/keyed-provider.js";
import {
	createProviderModule,
	type ProviderModuleOptions,
} from "../application/provider-module.js";
import { GOOGLE_BASE_URL, GOOGLE_MODELS_URL } from "../defaults.js";

// Google AI Studio (docs/09, provider facts): the Gemini API's OpenAI-compatible endpoints. Its free
// tier trains on prompts, so models.yaml marks every row `trains: true` and the gateway uses them
// only when the user allows training. The model list names models `models/<id>`; chat takes `<id>`.

/** The provider-google definition. */
export const GOOGLE = keyedProvider({
	providerId: "google",
	displayName: "Google AI Studio",
	baseURL: GOOGLE_BASE_URL,
	modelsURL: GOOGLE_MODELS_URL,
	idPrefix: "models/",
});

/** Creates the provider-google module. */
export const createGoogleModule = (opts?: ProviderModuleOptions): MeteModule =>
	createProviderModule(GOOGLE, opts);
