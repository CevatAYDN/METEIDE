import { z } from "zod";
import { DAILY_SPEND_USD } from "../defaults.js";

/**
 * The `gateway:` section (docs/09, Gateway; ADR-042): the model mode and the daily spending cap;
 * a workspace may set it in .mete/gateway.yaml. Here so the desktop's form validates it (ADR-082).
 */
export const GatewaySettingsSchema = z
	.strictObject({
		models: z.enum(["free", "paid", "both"]).default("free"),
		dailySpendUsd: z.number().positive().default(DAILY_SPEND_USD),
	})
	.prefault({});
