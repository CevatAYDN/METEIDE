import { isDeepStrictEqual } from "node:util";
import {
	err,
	SkillApproveInputSchema,
	type SkillTrustAdapter,
} from "@mete/contracts";
import { inspectCurrentSkill, readSkillInventory } from "./skill-evidence.js";
import {
	checkSkillMutation,
	runSkillMutation,
	type SkillMutationOptions,
	writeSkillGrant,
} from "./skill-mutation.js";
import {
	type createSkillPreviews,
	maskedInspectionDigest,
	type PendingSkillPreview,
} from "./skill-previews.js";
import { maskSkillInspection, skillFailure } from "./skill-readers.js";

const current = (
	opts: SkillMutationOptions,
	preview: PendingSkillPreview,
	signal: AbortSignal,
) => {
	const ready = checkSkillMutation(opts, preview.readers, signal);
	if (!ready.ok) return ready;
	return preview.expiresAt <= (opts.now ?? Date.now)()
		? skillFailure("expired")
		: ready;
};
const inspect = async (
	opts: SkillMutationOptions,
	preview: PendingSkillPreview,
	signal: AbortSignal,
) => {
	const ready = current(opts, preview, signal);
	if (!ready.ok) return ready;
	const inventory = await readSkillInventory(preview.readers, signal);
	if (!inventory.ok) return inventory;
	const id = preview.source.sourceId;
	const source = inventory.value.sources.sources.find((s) => s.sourceId === id);
	if (!source) return skillFailure("not_found");
	if (!isDeepStrictEqual(source, preview.source)) return skillFailure("stale");
	const diagnostic = [
		...inventory.value.sources.diagnostics,
		...inventory.value.catalog.diagnostics,
	].find((d) => d.sourceId === id);
	if (diagnostic) return err(diagnostic);
	if (!inventory.value.catalog.entries.some((e) => e.source.sourceId === id))
		return skillFailure();
	const raw = await inspectCurrentSkill(preview.readers, source, signal);
	if (!raw.ok) return raw;
	if (raw.value.sha256 !== preview.sha256) return skillFailure("stale");
	const masked = await maskSkillInspection(preview.readers, raw.value, signal);
	if (!masked.ok) return masked;
	return maskedInspectionDigest(masked.value) === preview.maskedSha256
		? masked
		: skillFailure("stale");
};
const approve = async (
	opts: SkillMutationOptions,
	preview: PendingSkillPreview,
	signal: AbortSignal,
) => {
	const inspected = await inspect(opts, preview, signal);
	if (!inspected.ok) return inspected;
	const ready = current(opts, preview, signal);
	if (!ready.ok) return ready;
	return writeSkillGrant(
		opts,
		{
			source: preview.source,
			sha256: preview.sha256,
			enabled: true,
			expectedRevision: preview.revision,
		},
		{
			source: inspected.value.source,
			metadata: inspected.value.metadata,
			status: "approved",
			revision: preview.revision + 1,
			approvedSha256: preview.sha256,
			currentSha256: preview.sha256,
			diagnostics: [],
		},
	);
};

/** Consume once before admission; reread, remask and CAS only after the native guard succeeds. */
export const createSkillApprover =
	(
		opts: SkillMutationOptions,
		previews: Pick<ReturnType<typeof createSkillPreviews>, "consume">,
	): SkillTrustAdapter["approve"] =>
	async (raw, signal) => {
		try {
			const input = SkillApproveInputSchema.safeParse(raw);
			if (!input.success)
				return { admitted: false, result: skillFailure("bad_input") };
			const preview = previews.consume(input.data.previewId);
			if (!preview.ok) return { admitted: false, result: preview };
			return runSkillMutation(opts, signal, () =>
				approve(opts, preview.value, signal),
			);
		} catch {
			return { admitted: false, result: skillFailure() };
		}
	};
