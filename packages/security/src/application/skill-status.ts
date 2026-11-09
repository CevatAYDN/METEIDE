import { isDeepStrictEqual } from "node:util";
import {
	ok,
	type Result,
	type SkillError,
	type SkillInspection,
	type SkillSourceDescriptor,
	type SkillTrustEntry,
	type SkillTrustList,
	SkillTrustListSchema,
} from "@mete/contracts";
import {
	inspectCurrentSkill,
	readSkillInventory,
	type SkillInventory,
} from "./skill-evidence.js";
import {
	callSkill,
	captureSkillReaders,
	maskSkillInspection,
	maskSkillSource,
	type SkillReaderOptions,
	type SkillReaders,
	skillFailure,
} from "./skill-readers.js";

/** Private grant read port; the module binds it to its canonical workspace key. */
export type SkillGrant = {
	readonly source: SkillSourceDescriptor;
	readonly sha256: string;
	readonly enabled: boolean;
	readonly revision: number;
};
/** Application code never imports the SQLite adapter or controls its database lifetime. */
export type SkillGrantReader = {
	readonly list: () => Result<SkillGrant[], SkillError>;
	readonly read: (
		sourceId: string,
	) => Result<SkillGrant | undefined, SkillError>;
};
/** One operation captures native readers and reads only this workspace's global grants. */
export type SkillStatusOptions = SkillReaderOptions & {
	readonly grants: SkillGrantReader;
};
type Subject = { source: SkillSourceDescriptor; grant: SkillGrant | undefined };
const failedStatus = (code: SkillError["code"]) =>
	code === "not_found"
		? "missing"
		: code === "bad_input" || code === "ignored"
			? "invalid"
			: "unavailable";

const inventoryFailure = (
	present: boolean,
	known: boolean,
	diagnostic: SkillError | undefined,
): SkillError | undefined => {
	if (diagnostic) return diagnostic;
	if (!present) return { code: "not_found" };
	if (!known) return { code: "unavailable" };
	return undefined;
};
const grantStatus = (
	grant: SkillGrant | undefined,
	sha256: string,
): SkillTrustEntry["status"] => {
	if (!grant) return "unapproved";
	if (!grant.enabled) return "disabled";
	return grant.sha256 === sha256 ? "approved" : "changed";
};
const displayEntry = (
	grant: SkillGrant | undefined,
	inspected: Result<SkillInspection, SkillError>,
	masked: SkillInspection | SkillSourceDescriptor,
	diagnostics: SkillError[],
): Result<SkillTrustEntry, SkillError> => {
	const base = {
		source: "source" in masked ? masked.source : masked,
		revision: grant?.revision ?? 0,
		...(grant?.enabled ? { approvedSha256: grant.sha256 } : {}),
	};
	if (!inspected.ok)
		return ok({
			...base,
			status: failedStatus(inspected.error.code),
			diagnostics: diagnostics.length ? diagnostics : [inspected.error],
		});
	if (!("metadata" in masked)) return skillFailure();
	return ok({
		...base,
		status: grantStatus(grant, inspected.value.sha256),
		metadata: masked.metadata,
		currentSha256: inspected.value.sha256,
		diagnostics: [],
	});
};
const entryFor = async (
	r: SkillReaders,
	inventory: SkillInventory,
	subject: Subject,
	signal: AbortSignal,
): Promise<Result<SkillTrustEntry, SkillError>> => {
	const { source, grant } = subject;
	const id = source.sourceId;
	const present = inventory.sources.sources.some((s) => s.sourceId === id);
	const known = inventory.catalog.entries.some((e) => e.source.sourceId === id);
	const diagnostics = [
		...inventory.sources.diagnostics,
		...inventory.catalog.diagnostics,
	].filter((d) => d.sourceId === id);
	const problem = inventoryFailure(present, known, diagnostics[0]);
	const inspected = problem
		? { ok: false as const, error: problem }
		: await inspectCurrentSkill(r, source, signal);
	if (!inspected.ok && ["stale", "aborted"].includes(inspected.error.code))
		return inspected;
	const masked = inspected.ok
		? await maskSkillInspection(r, inspected.value, signal)
		: await maskSkillSource(r, source, signal);
	if (!masked.ok) return masked;
	return displayEntry(grant, inspected, masked.value, diagnostics);
};
const mergeSubjects = (
	snapshot: SkillGrant[],
	current: SkillSourceDescriptor[],
) => {
	const grants = new Map(snapshot.map((g) => [g.source.sourceId, g]));
	const sources = new Map(snapshot.map((g) => [g.source.sourceId, g.source]));
	for (const source of current) {
		const prior = sources.get(source.sourceId);
		if (prior && !isDeepStrictEqual(prior, source))
			return skillFailure("stale");
		sources.set(source.sourceId, source);
	}
	return ok({ grants, sources });
};
const readOverflowStatus = async (
	opts: SkillStatusOptions,
	r: SkillReaders,
	signal: AbortSignal,
	diagnostic: SkillError,
): Promise<Result<SkillTrustList, SkillError>> => {
	const records = opts.grants.list();
	if (!records.ok) return records;
	const snapshot = structuredClone(records.value);
	const entries: SkillTrustEntry[] = [];
	for (const grant of snapshot) {
		const source = await maskSkillSource(r, grant.source, signal);
		if (!source.ok) return source;
		entries.push({
			source: source.value,
			status: "unavailable",
			revision: grant.revision,
			...(grant.enabled ? { approvedSha256: grant.sha256 } : {}),
			diagnostics: [diagnostic],
		});
	}
	const latest = opts.grants.list();
	if (!latest.ok) return latest;
	if (!isDeepStrictEqual(snapshot, latest.value)) return skillFailure("stale");
	return ok({ entries, complete: false, diagnostics: [diagnostic] });
};
const readStatusEntries = async (
	opts: SkillStatusOptions,
	r: SkillReaders,
	signal: AbortSignal,
): Promise<Result<SkillTrustList, SkillError>> => {
	const inventory = await readSkillInventory(r, signal);
	// Discovery overflow blocks new approval, not visibility of revocable receipts.
	if (!inventory.ok)
		return inventory.error.code === "limit_exceeded"
			? readOverflowStatus(opts, r, signal, inventory.error)
			: inventory;
	const records = opts.grants.list();
	if (!records.ok) return records;
	const snapshot = structuredClone(records.value);
	const subjects = mergeSubjects(snapshot, inventory.value.sources.sources);
	if (!subjects.ok) return subjects;
	const { grants, sources } = subjects.value;
	const entries: SkillTrustEntry[] = [];
	for (const source of sources.values()) {
		const result = await entryFor(
			r,
			inventory.value,
			{ source, grant: grants.get(source.sourceId) },
			signal,
		);
		if (!result.ok) return result;
		entries.push(result.value);
	}
	const latest = opts.grants.list();
	if (!latest.ok) return latest;
	if (!isDeepStrictEqual(snapshot, latest.value)) return skillFailure("stale");
	const diagnostics = [
		...inventory.value.sources.diagnostics,
		...inventory.value.catalog.diagnostics,
	].filter((d) => d.sourceId === undefined || !sources.has(d.sourceId));
	return ok({ entries, complete: true, diagnostics });
};

/** Read-only status; missing/invalid evidence overrides historical approval. */
export const readSkillStatus = async (
	opts: SkillStatusOptions,
	signal: AbortSignal,
): Promise<Result<SkillTrustList, SkillError>> => {
	const captured = captureSkillReaders(opts);
	if (!captured.ok) return captured;
	const r = captured.value;
	return callSkill(r, signal, SkillTrustListSchema, () =>
		readStatusEntries(opts, r, signal),
	);
};
