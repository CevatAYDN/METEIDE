import { z } from "zod";
import { IdSchema } from "./ids.js";
import { PolicyAskSchema } from "./policy.js";
import type { Result } from "./result.js";

/** A masked policy ask with the immutable request identity retained by security (ADR-181). */
export const PolicyRequestSchema = z.strictObject({
	requestId: IdSchema,
	runId: IdSchema,
	agentId: IdSchema,
	ask: PolicyAskSchema,
	rule: z.string().min(1),
});

/** One pending policy ask, not caller-owned replacement action arguments. */
export type PolicyRequest = z.infer<typeof PolicyRequestSchema>;

/** policy.requests@1 pending: list requests for one agent attempt. */
export const PolicyPendingInputSchema = z.strictObject({
	runId: IdSchema,
	agentId: IdSchema,
});

/** The exact run and agent whose policy asks are requested. */
export type PolicyPendingInput = z.infer<typeof PolicyPendingInputSchema>;

/** The pending masked asks returned by policy.requests@1. */
export const PolicyPendingResultSchema = z.strictObject({
	requests: z.array(PolicyRequestSchema),
});

/** Pending policy requests with their server-owned identities. */
export type PolicyPendingResult = z.infer<typeof PolicyPendingResultSchema>;

/** Grant an exact request once or for its agent attempt, never by command or path. */
export const PolicyGrantRequestSchema = z.strictObject({
	runId: IdSchema,
	agentId: IdSchema,
	requestId: IdSchema,
	scope: z.enum(["once", "task"]),
});

/** The human's grant for one retained policy request (ADR-181). */
export type PolicyGrantRequest = z.infer<typeof PolicyGrantRequestSchema>;

/** Forget one agent attempt's requests or all requests for a run. */
export const PolicyForgetInputSchema = z.strictObject({
	runId: IdSchema,
	agentId: IdSchema.optional(),
});

/** The run and optional agent whose process-local requests expire. */
export type PolicyForgetInput = z.infer<typeof PolicyForgetInputSchema>;

/** Expected failures from policy.requests@1. */
export const PolicyRequestErrorSchema = z.strictObject({
	code: z.enum(["bad_input", "not_found", "failed"]),
	message: z.string(),
});

/** Why a policy request operation was refused. */
export type PolicyRequestError = z.infer<typeof PolicyRequestErrorSchema>;

/** policy.requests@1: read masked asks and manage exact process-local grants. */
export interface PolicyRequestsAdapter {
	pending(
		input: PolicyPendingInput,
	): Promise<Result<PolicyPendingResult, PolicyRequestError>>;
	grant(input: PolicyGrantRequest): Result<void, PolicyRequestError>;
	forget(input: PolicyForgetInput): Result<void, PolicyRequestError>;
}
