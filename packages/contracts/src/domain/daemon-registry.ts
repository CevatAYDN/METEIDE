import { z } from "zod";
import { McpServerSchema } from "./mcp.js";
import { RegistryEntrySchema } from "./registry.js";

/** Protocol 29 read-only catalog request; discovery never installs a server. */
export const DaemonRegistrySearchParamsSchema = z.strictObject({
	query: z.string().trim().min(1),
});
/** Validated entries returned by the configured registry chain. */
export const DaemonRegistrySearchResultSchema = z.strictObject({
	entries: z.array(RegistryEntrySchema),
});
/** Prepare the official registry entry by its identity, not an arbitrary URL. */
export const DaemonRegistryPrepareParamsSchema = z.strictObject({
	name: z.string().trim().min(1),
});
/** A reviewable draft, not a connected or installed tool. */
export const DaemonRegistryPrepareResultSchema = z.strictObject({
	server: McpServerSchema,
	notes: z.array(z.string()),
	source: z.string().min(1),
});
