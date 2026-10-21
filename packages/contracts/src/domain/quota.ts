import { z } from "zod";
import { IdSchema, TimestampSchema } from "./ids.js";
import type { Result } from "./result.js";
import { QuotaUnitSchema } from "./states.js";

// quota.reserve@1 from docs/06 (Kernel API) and docs/09 (Quota pool, Scheduler).

const text = z.string().min(1);

/** One limit a provider adapter ships through `quotaUnits()` (docs/09). */
export const QuotaUnitSpecSchema = z.strictObject({
	providerId: text,
	unit: QuotaUnitSchema,
	limit: z.union([z.number().positive(), z.literal("discover")]),
	scope: z.enum(["account", "model"]),
	reset: z.enum(["sliding", "fixed_daily", "fixed_monthly"]),
});

/** A provider limit for one unit. */
export type QuotaUnitSpec = z.infer<typeof QuotaUnitSpecSchema>;

/** Amounts per unit; a request unit left out counts 1. */
export const QuotaAmountsSchema = z.partialRecord(
	QuotaUnitSchema,
	z.number().nonnegative(),
);

/** Amounts per quota unit. */
export type QuotaAmounts = z.infer<typeof QuotaAmountsSchema>;

/** What a provider's `observe()` read from response headers or a 429. */
export const QuotaObservationSchema = z.strictObject({
	unit: QuotaUnitSchema,
	limit: z.number().positive().optional(),
	remaining: z.number().nonnegative().optional(),
	resetsAt: TimestampSchema.optional(),
	exhausted: z.boolean(),
});

/** One observation about a unit of the provider that answered. */
export type QuotaObservation = z.infer<typeof QuotaObservationSchema>;

/** Input of `reserve`: priority 0 interactive, 1 foreground, 2 scheduled. */
export const QuotaRequestSchema = z.strictObject({
	runId: IdSchema,
	priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
	chain: z
		.array(z.strictObject({ providerId: text, modelId: text }))
		.min(1)
		.readonly(),
	estimate: QuotaAmountsSchema,
});

/** What a caller asks quota.reserve@1. */
export type QuotaRequest = z.infer<typeof QuotaRequestSchema>;

/** Capacity held for one call on the chosen chain entry. */
export type Reservation = {
	readonly id: string;
	readonly providerId: string;
	readonly modelId: string;
};

/** No capacity before `resumesAt` (ISO 8601), or the signal aborted the wait. */
export type ReserveFailed =
	| { readonly code: "quota_exhausted"; readonly resumesAt: string }
	| { readonly code: "aborted" };

/** `settle` got an id that is unknown or already settled. */
export type UnknownReservation = {
	readonly code: "unknown_reservation";
	readonly id: string;
};

/** The quota.reserve@1 adapter; the gateway settles every reservation it gets. */
export interface QuotaReserveAdapter {
	define(specs: readonly QuotaUnitSpec[]): void;
	reserve(
		req: QuotaRequest,
		signal: AbortSignal,
	): Promise<Result<Reservation, ReserveFailed>>;
	/** `actual: null` means no call was sent and releases the reservation. */
	settle(
		id: string,
		actual: QuotaAmounts | null,
		observations: readonly QuotaObservation[],
	): Result<void, UnknownReservation>;
}
