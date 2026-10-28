import type {
	ProviderAdapter,
	ProviderError,
	SecretsMaskAdapter,
} from "@mete/contracts";
import { PROBE_PROMPT, PROBE_TIMEOUT_MS } from "../defaults.js";
import type { App } from "../infrastructure/app.js";
import { LISTING_TIMEOUT_MS } from "./provider-states.js";

// What `mete/provider.models` and `mete/provider.test` answer (ADR-087): a custom endpoint's models,
// and one probe per model sent to its adapter directly, so no quota is reserved and no model_calls
// row is written. A provider's message passes secrets.mask@1; its headers are never passed on.

/** The registered provider.chat@2 adapter with this id, or undefined while it is not loaded. */
export const customAdapter = (
	app: App,
	id: string,
): ProviderAdapter | undefined => {
	const r = app.registry.resolve<ProviderAdapter>("provider.chat@2");
	return r.ok ? r.value.find((a) => a.impl.id === id)?.impl : undefined;
};

const failureOf = async (e: ProviderError, mask: SecretsMaskAdapter) => ({
	code: e.code,
	message: (await mask.mask(e.message)).text,
	...(e.status === undefined ? {} : { status: e.status }),
});

/** The endpoint's models as its listing gives them, or why the listing failed. */
export const endpointModels = async (
	adapter: ProviderAdapter,
	mask: SecretsMaskAdapter,
) => {
	const listed = await adapter.listModels(
		AbortSignal.timeout(LISTING_TIMEOUT_MS),
	);
	return listed.ok
		? { models: listed.value }
		: { failed: await failureOf(listed.error, mask) };
};

const probe = async (
	adapter: ProviderAdapter,
	modelId: string,
	mask: SecretsMaskAdapter,
) => {
	const started = Date.now();
	const stream = adapter.chat(
		{
			model: modelId,
			messages: [{ role: "user", content: PROBE_PROMPT }],
		},
		AbortSignal.timeout(PROBE_TIMEOUT_MS),
	);
	for await (const chunk of stream) {
		if (chunk.type === "finish")
			return { modelId, ok: true as const, ms: Date.now() - started };
		if (chunk.type === "error")
			return {
				modelId,
				ok: false as const,
				failed: await failureOf(chunk.error, mask),
			};
	}
	// provider.chat@2 ends every stream with finish or error, so this is a broken adapter.
	throw new Error(`${adapter.id} ended a stream without finish or error`);
};

/** One probe per model, one after another, in the order asked. */
export const probeModels = async (
	adapter: ProviderAdapter,
	models: readonly string[],
	mask: SecretsMaskAdapter,
) => {
	const results = [];
	for (const modelId of models)
		results.push(await probe(adapter, modelId, mask));
	return { results };
};
