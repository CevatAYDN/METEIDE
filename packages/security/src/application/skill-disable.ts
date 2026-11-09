import {
	type SkillDisableInput,
	SkillDisableInputSchema,
	type SkillTrustAdapter,
} from "@mete/contracts";
import {
	checkSkillMutation,
	runSkillMutation,
	type SkillMutationOptions,
	writeSkillGrant,
} from "./skill-mutation.js";
import {
	captureSkillReaders,
	maskSkillSource,
	type SkillReaders,
	skillFailure,
} from "./skill-readers.js";

const revoke = async (
	opts: SkillMutationOptions,
	readers: SkillReaders,
	input: SkillDisableInput,
	signal: AbortSignal,
) => {
	const ready = checkSkillMutation(opts, readers, signal);
	if (!ready.ok) return ready;
	const found = opts.grants.read(input.sourceId);
	if (!found.ok) return found;
	if (!found.value) return skillFailure("not_found");
	const grant = found.value;
	if (grant.revision !== input.expectedRevision) return skillFailure("stale");
	// Revocation removes eligibility; missing/invalid file contents cannot authorize a new grant.
	const source = await maskSkillSource(readers, grant.source, signal);
	if (!source.ok) return source;
	const current = checkSkillMutation(opts, readers, signal);
	if (!current.ok) return current;
	return writeSkillGrant(
		opts,
		{
			source: grant.source,
			sha256: grant.sha256,
			enabled: false,
			expectedRevision: input.expectedRevision,
		},
		{
			source: source.value,
			status: "disabled",
			revision: input.expectedRevision + 1,
			diagnostics: [],
		},
	);
};

/** Revoke only an existing exact receipt, after native admission and without reading its file. */
export const createSkillDisabler =
	(opts: SkillMutationOptions): SkillTrustAdapter["disable"] =>
	async (raw, signal) => {
		try {
			const input = SkillDisableInputSchema.safeParse(raw);
			if (!input.success)
				return { admitted: false, result: skillFailure("bad_input") };
			const readers = captureSkillReaders(opts);
			if (!readers.ok) return { admitted: false, result: readers };
			return runSkillMutation(opts, signal, () =>
				revoke(opts, readers.value, input.data, signal),
			);
		} catch {
			return { admitted: false, result: skillFailure() };
		}
	};
