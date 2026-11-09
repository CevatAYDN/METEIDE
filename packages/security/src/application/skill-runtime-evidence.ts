import {
	err,
	ok,
	type Result,
	type SkillInspection,
	SkillInspectionSchema,
	type SkillRuntimeError,
	SkillSourceListSchema,
	type SkillTrustList,
	type SkillVersion,
} from "@mete/contracts";
import { callSkill, maskSkillInspection } from "./skill-readers.js";
import {
	readSkillRuntimeTrust,
	type SkillRuntimeReaders,
} from "./skill-runtime-readers.js";

type Checked = Result<null, SkillRuntimeError>;
const fail = (code: SkillRuntimeError["code"], sourceId?: string): Checked =>
	err(sourceId === undefined ? { code } : { code, sourceId });

/** Refuses any version that is not the exact current enabled grant. */
const matchGrants = (
	status: SkillTrustList,
	selected: readonly SkillVersion[],
): Checked => {
	for (const version of selected) {
		const entry = status.entries.find(
			(item) => item.source.sourceId === version.sourceId,
		);
		if (entry === undefined) return fail("not_found", version.sourceId);
		if (
			entry.status !== "approved" ||
			entry.revision !== version.revision ||
			entry.approvedSha256 !== version.sha256
		)
			return fail("revoked", version.sourceId);
	}
	return ok(null);
};

/** Current complete trust status must hold every exact selected version. */
export const checkSkillGrants = async (
	readers: SkillRuntimeReaders,
	selected: readonly SkillVersion[],
	signal: AbortSignal,
): Promise<Checked> => {
	const status = await readSkillRuntimeTrust(readers, signal);
	return status.ok ? matchGrants(status.value, selected) : status;
};

/** Selected sources must appear in a complete native source inventory. */
export const requireCompleteSkillSources = async (
	readers: SkillRuntimeReaders,
	selected: readonly SkillVersion[],
	signal: AbortSignal,
): Promise<Checked> => {
	const list = await callSkill(readers, signal, SkillSourceListSchema, () =>
		readers.source.list(signal),
	);
	if (!list.ok) return list;
	if (!list.value.complete) return fail("unavailable");
	const ids = new Set(list.value.sources.map(({ sourceId }) => sourceId));
	const absent = selected.find(({ sourceId }) => !ids.has(sourceId));
	return absent === undefined ? ok(null) : fail("not_found", absent.sourceId);
};

/** Full masked inspection of the exact raw bytes; a changed digest is refused. */
export const readMaskedSkillVersion = async (
	readers: SkillRuntimeReaders,
	version: SkillVersion,
	signal: AbortSignal,
): Promise<Result<SkillInspection, SkillRuntimeError>> => {
	const raw = await callSkill<SkillInspection>(
		readers,
		signal,
		SkillInspectionSchema,
		() => readers.catalog.inspect({ sourceId: version.sourceId }, signal),
	);
	if (!raw.ok) return raw;
	if (raw.value.sha256 !== version.sha256)
		return err({ code: "integrity_failed", sourceId: version.sourceId });
	return maskSkillInspection(readers, raw.value, signal);
};

/** Treats a throwing lifetime probe as retired. */
export const lifetimeCurrent = (current: () => boolean): boolean => {
	try {
		return current();
	} catch {
		return false;
	}
};
