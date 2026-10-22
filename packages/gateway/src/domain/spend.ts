import {
	ANY_PROVIDER,
	type ModelInfo,
	type QuotaUnitSpec,
} from "@mete/contracts";
import { z } from "zod";
import { DAILY_SPEND_USD } from "../defaults.js";

// The model mode and the daily spending cap of ADR-042 (docs/09, Gateway). Pure.

/** The `gateway:` settings section; a workspace may set it in .mete/gateway.yaml. */
export const GatewaySettingsSchema = z
	.strictObject({
		models: z.enum(["free", "paid", "both"]).default("free"),
		dailySpendUsd: z.number().positive().default(DAILY_SPEND_USD),
	})
	.prefault({});

/** Which models are candidates: free ones, paid ones, or free first and then paid. */
export type ModelMode = z.output<typeof GatewaySettingsSchema>["models"];

/** A paid candidate: not free and with a known price (a model without one is neither). */
export const isPaid = (m: ModelInfo) => !m.free && m.price !== undefined;

/** Whether a model is a candidate in this mode. */
export const inMode = (m: ModelInfo, mode: ModelMode) =>
	mode === "free" ? m.free : mode === "paid" ? isPaid(m) : m.free || isPaid(m);

/** The spending cap as a quota unit over every provider, reset at 00:00 UTC. */
export const spendSpec = (dailySpendUsd: number): QuotaUnitSpec => ({
	providerId: ANY_PROVIDER,
	unit: "usd_per_day",
	limit: dailySpendUsd,
	scope: "account",
	reset: "fixed_daily",
});

/** What a call costs in US dollars at a price per million tokens. */
export const costUsd = (
	price: NonNullable<ModelInfo["price"]>,
	tokens: { readonly prompt: number; readonly completion: number },
) =>
	(tokens.prompt * price.input + tokens.completion * price.output) / 1_000_000;

/** The quota amounts of a paid model's call: its cost; a free model has none. */
export const costOf = (
	m: ModelInfo,
	tokens: { readonly prompt: number; readonly completion: number },
) => (isPaid(m) && m.price ? { usd_per_day: costUsd(m.price, tokens) } : {});
