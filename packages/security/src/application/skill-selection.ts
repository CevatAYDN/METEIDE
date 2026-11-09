import {
	err,
	ok,
	type Result,
	SKILL_RUNTIME_LIMITS,
	type SkillRuntimeError,
	type SkillSelectionInput,
	SkillSelectionInputSchema,
	type SkillVersion,
} from "@mete/contracts";
import {
	checkSkillGrants,
	lifetimeCurrent,
	readMaskedSkillVersion,
	requireCompleteSkillSources,
} from "./skill-runtime-evidence.js";
import {
	captureSkillRuntimeReaders,
	type SkillRuntimeReaderOptions,
	type SkillRuntimeReaders,
} from "./skill-runtime-readers.js";

type Checked = Result<null, SkillRuntimeError>;
const encoder = new TextEncoder();

const checkBudget = async (
	readers: SkillRuntimeReaders,
	selected: readonly SkillVersion[],
	signal: AbortSignal,
): Promise<Checked> => {
	let total = 0;
	for (const version of selected) {
		const masked = await readMaskedSkillVersion(readers, version, signal);
		if (!masked.ok) return masked;
		total += encoder.encode(masked.value.text).byteLength;
	}
	return total > SKILL_RUNTIME_LIMITS.totalBytes
		? err({ code: "budget_exceeded" })
		: ok(null);
};

const checkNonempty = async (
	readers: SkillRuntimeReaders,
	selected: readonly SkillVersion[],
	signal: AbortSignal,
): Promise<Checked> => {
	const steps = [
		() => requireCompleteSkillSources(readers, selected, signal),
		() => checkSkillGrants(readers, selected, signal),
		() => checkBudget(readers, selected, signal),
		// Grants may change while bodies were read and masked (ADR-191).
		() => checkSkillGrants(readers, selected, signal),
	];
	for (const step of steps) {
		const result = await step();
		if (!result.ok) return result;
	}
	return ok(null);
};

/** skill.selection@1.check: read-only; creates no run, receipt, preview or grant (ADR-191). */
export const checkSkillSelection = async (
	opts: SkillRuntimeReaderOptions,
	input: SkillSelectionInput,
	signal: AbortSignal,
): Promise<Checked> => {
	const parsed = SkillSelectionInputSchema.safeParse(input);
	if (!parsed.success) return err({ code: "bad_input" });
	if (signal.aborted) return err({ code: "aborted" });
	if (!lifetimeCurrent(opts.current)) return err({ code: "stale" });
	if (parsed.data.selected.length === 0) return ok(null);
	const readers = captureSkillRuntimeReaders(opts);
	if (!readers.ok) return readers;
	const result = await checkNonempty(
		readers.value,
		parsed.data.selected,
		signal,
	);
	if (signal.aborted) return err({ code: "aborted" });
	if (!lifetimeCurrent(opts.current) || !readers.value.current())
		return err({ code: "stale" });
	return result;
};
