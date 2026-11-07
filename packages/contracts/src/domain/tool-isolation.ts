import { z } from "zod";
import { CapabilityRefSchema } from "./ids.js";
import type { Result } from "./result.js";
import type { ToolError } from "./tools.js";

const text = z.string().min(1);

/** The exact adapter call whose confinement is inspected (ADR-181). */
export const ToolIsolationInputSchema = z.strictObject({
	capability: CapabilityRefSchema,
	adapterId: text,
	input: z.unknown(),
	cwd: text.optional(),
});

/** An adapter's isolation claim; missing support never implies confinement. */
export const ToolIsolationSchema = z.discriminatedUnion("scope", [
	z.strictObject({ scope: z.literal("workspace") }),
	z.strictObject({ scope: z.literal("worktree"), root: text }),
]);

/** Input of tool.isolation@1. */
export type ToolIsolationInput = z.infer<typeof ToolIsolationInputSchema>;
/** Canonical root of a confined call, or exclusive workspace execution. */
export type ToolIsolation = z.infer<typeof ToolIsolationSchema>;

/** Registered with the same id and trust as the described tool adapter. */
export interface ToolIsolationAdapter {
	inspect(
		input: ToolIsolationInput,
		signal: AbortSignal,
	): Promise<Result<ToolIsolation, ToolError>>;
}
