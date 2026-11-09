import {
	ok,
	type Result,
	type SkillError,
	SkillErrorSchema,
	type SkillMutationResult,
	SkillMutationResultSchema,
	type SkillTrustEntry,
	SkillTrustEntrySchema,
} from "@mete/contracts";
import { z } from "zod";
import type { SkillPreviewOptions } from "./skill-previews.js";
import { type SkillReaders, skillFailure } from "./skill-readers.js";
import type { SkillGrant } from "./skill-status.js";

/** Native receipt preserves confirmed quiesce even when a later composition check fails. */
export type SkillAdmission = {
	readonly admitted: boolean;
	readonly result: Result<void, SkillError>;
};
/** Native composition owns admission and the lifetime of this exact adapter instance. */
type SkillAdmissionOptions = {
	readonly admit: (signal: AbortSignal) => Promise<SkillAdmission>;
	readonly active: () => boolean;
};
/** Private workspace-bound write input; never exposed through the capability API. */
export type SkillGrantUpdate = Omit<SkillGrant, "revision"> & {
	readonly expectedRevision: number;
	readonly at: string;
};
/** Reads and writes share the module's global database and canonical workspace key. */
export type SkillMutationOptions = SkillPreviewOptions &
	SkillAdmissionOptions & {
		readonly update: (
			input: SkillGrantUpdate,
		) => Result<SkillGrant, SkillError>;
	};
const AdmissionSchema = z.strictObject({
	admitted: z.boolean(),
	result: z.discriminatedUnion("ok", [
		z.strictObject({ ok: z.literal(true), value: z.undefined() }),
		z.strictObject({ ok: z.literal(false), error: SkillErrorSchema }),
	]),
});
const outcome = (admitted: boolean, result: unknown): SkillMutationResult => {
	const parsed = SkillMutationResultSchema.safeParse({ admitted, result });
	return parsed.success ? parsed.data : { admitted, result: skillFailure() };
};

/** Never race cancellation against irreversible drain; preserve success even on later failure. */
export const runSkillMutation = async (
	opts: SkillAdmissionOptions,
	signal: AbortSignal,
	work: () => Promise<unknown>,
): Promise<SkillMutationResult> => {
	let admitted = false;
	try {
		if (signal.aborted) return outcome(false, skillFailure("aborted"));
		if (!opts.active()) return outcome(false, skillFailure());
		const raw: unknown = await opts.admit(signal);
		admitted = z.object({ admitted: z.literal(true) }).safeParse(raw).success;
		const guard = AdmissionSchema.safeParse(raw);
		if (!guard.success) return outcome(admitted, skillFailure());
		if (!guard.data.result.ok) return outcome(admitted, guard.data.result);
		if (!admitted) return outcome(false, skillFailure());
		if (signal.aborted) return outcome(true, skillFailure("aborted"));
		if (!opts.active()) return outcome(true, skillFailure());
		return outcome(true, await work());
	} catch {
		return outcome(
			admitted,
			skillFailure(signal.aborted ? "aborted" : "unavailable"),
		);
	}
};

/** Recheck after each awaited mutation step and immediately before the synchronous commit. */
export const checkSkillMutation = (
	opts: SkillAdmissionOptions,
	readers: SkillReaders,
	signal: AbortSignal,
) => {
	if (signal.aborted) return skillFailure("aborted");
	if (!opts.active()) return skillFailure();
	return readers.current() ? ok(undefined) : skillFailure("stale");
};

/** Validate the safe acknowledgment before writing; success follows the atomic grant/audit update. */
export const writeSkillGrant = (
	opts: SkillMutationOptions,
	input: Omit<SkillGrantUpdate, "at">,
	entry: SkillTrustEntry,
): Result<SkillTrustEntry, SkillError> => {
	const parsed = SkillTrustEntrySchema.safeParse(entry);
	if (!parsed.success) return skillFailure();
	const written = opts.update({
		...input,
		at: new Date((opts.now ?? Date.now)()).toISOString(),
	});
	if (!written.ok) return written;
	if (written.value.revision !== input.expectedRevision + 1)
		return skillFailure("storage_failed");
	return ok({ ...parsed.data, revision: written.value.revision });
};
