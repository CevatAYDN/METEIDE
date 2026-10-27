import { z } from "zod";
import { CustomProviderIdSchema, ModelInfoSchema } from "./provider.js";

// The Settings screen's custom endpoint requests of the daemon protocol (ARCHITECTURE.md, ADR-087).

/** Params of `mete/provider.models`: a custom endpoint by its provider id (ADR-087). */
export const DaemonProviderModelsParamsSchema = z.strictObject({
	providerId: CustomProviderIdSchema,
});

// A provider's failure as the daemon passes it on: its code, status and masked message, no headers.
const ProviderFailureSchema = z.strictObject({
	code: z.enum([
		"rate_limited",
		"unauthorized",
		"bad_request",
		"server",
		"network",
		"aborted",
	]),
	message: z.string(),
	status: z.number().int().optional(),
});

/** Result of `mete/provider.models`: the endpoint's models as its listing gives them, or why it failed. */
export const DaemonProviderModelsResultSchema = z.union([
	z.strictObject({ models: z.array(ModelInfoSchema) }),
	z.strictObject({ failed: ProviderFailureSchema }),
]);

/** Params of `mete/provider.test`: the endpoint and the models to probe, one call each (docs/09). */
export const DaemonProviderTestParamsSchema = z.strictObject({
	providerId: CustomProviderIdSchema,
	models: z.array(z.string().min(1)).min(1),
});

/** Result of `mete/provider.test`: per model, in the order asked, how its probe ended. */
export const DaemonProviderTestResultSchema = z.strictObject({
	results: z.array(
		z.discriminatedUnion("ok", [
			z.strictObject({
				modelId: z.string().min(1),
				ok: z.literal(true),
				ms: z.number().int().nonnegative(),
			}),
			z.strictObject({
				modelId: z.string().min(1),
				ok: z.literal(false),
				failed: ProviderFailureSchema,
			}),
		]),
	),
});
