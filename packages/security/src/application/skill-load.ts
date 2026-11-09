import { createHash, randomUUID } from "node:crypto";
import {
	err,
	ok,
	type Result,
	type SkillInspection,
	type SkillReceipt,
	type SkillRuntimeError,
	type SkillRuntimeLoadInput,
	SkillRuntimeLoadInputSchema,
	type SkillSnapshot,
	SkillSnapshotSchema,
	skillSnapshotCanonical,
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

/** Private native-load authority: the exact input object of a live core operation. */
export type SkillLoadAdmission = {
	/** True only for the exact input object of a live core-owned operation. */
	readonly live: (input: SkillRuntimeLoadInput) => boolean;
	/** Refuses before commit when the retained context would exceed its budget. */
	readonly fits: (input: SkillRuntimeLoadInput, maskedBytes: number) => boolean;
};
/** Append-only receipt storage in security's global scope. */
export type SkillReceiptIssuer = {
	readonly issue: (input: {
		workspaceKey: string;
		receipt: SkillReceipt;
	}) => Result<SkillReceipt, SkillRuntimeError>;
};
/** Composition-owned load dependencies; clock and ids are injectable for tests. */
export type SkillLoadOptions = SkillRuntimeReaderOptions & {
	readonly admission: SkillLoadAdmission;
	readonly store: SkillReceiptIssuer;
	readonly workspaceKey: string;
	readonly now?: () => Date;
	readonly newId?: () => string;
};

type Loaded = Result<SkillSnapshot, SkillRuntimeError>;
const encoder = new TextEncoder();

const authorized = (opts: SkillLoadOptions, input: SkillRuntimeLoadInput) => {
	try {
		return lifetimeCurrent(opts.current) && opts.admission.live(input);
	} catch {
		return false;
	}
};

/** Builds the receipt-bound snapshot; the digest covers the full canonical payload. */
const buildSnapshot = (
	opts: SkillLoadOptions,
	input: SkillRuntimeLoadInput,
	inspection: SkillInspection,
): Result<SkillSnapshot, SkillRuntimeError> => {
	const unsigned = {
		receiptId: (opts.newId ?? randomUUID)(),
		owner: input.owner,
		inspection,
		revision: input.version.revision,
		origin: input.origin,
		loadedAt: (opts.now ?? (() => new Date()))().toISOString(),
	};
	const payloadSha256 = createHash("sha256")
		.update(skillSnapshotCanonical(unsigned))
		.digest("hex");
	const snapshot = SkillSnapshotSchema.safeParse({
		...unsigned,
		payloadSha256,
	});
	return snapshot.success
		? ok(snapshot.data)
		: err({ code: "integrity_failed", sourceId: input.version.sourceId });
};

const prepare = async (
	readers: SkillRuntimeReaders,
	input: SkillRuntimeLoadInput,
	signal: AbortSignal,
): Promise<Result<SkillInspection, SkillRuntimeError>> => {
	const selected = [input.version];
	const sources = await requireCompleteSkillSources(readers, selected, signal);
	if (!sources.ok) return sources;
	const before = await checkSkillGrants(readers, selected, signal);
	if (!before.ok) return before;
	const masked = await readMaskedSkillVersion(readers, input.version, signal);
	if (!masked.ok) return masked;
	// A disable or reapproval during masking must not issue a receipt.
	const after = await checkSkillGrants(readers, selected, signal);
	return after.ok ? masked : after;
};

const commit = (
	opts: SkillLoadOptions,
	input: SkillRuntimeLoadInput,
	inspection: SkillInspection,
): Loaded => {
	const bytes = encoder.encode(inspection.text).byteLength;
	if (!opts.admission.fits(input, bytes))
		return err({ code: "budget_exceeded", sourceId: input.version.sourceId });
	const snapshot = buildSnapshot(opts, input, inspection);
	if (!snapshot.ok) return snapshot;
	const { receiptId, loadedAt, payloadSha256 } = snapshot.value;
	const issued = opts.store.issue({
		workspaceKey: opts.workspaceKey,
		receipt: { ...input, receiptId, loadedAt, payloadSha256 },
	});
	return issued.ok ? snapshot : issued;
};

/** skill.runtime@1.load: the receipt is durable before the snapshot is returned (ADR-190). */
export const loadSkillVersion = async (
	opts: SkillLoadOptions,
	input: SkillRuntimeLoadInput,
	signal: AbortSignal,
): Promise<Loaded> => {
	if (!SkillRuntimeLoadInputSchema.safeParse(input).success)
		return err({ code: "bad_input" });
	if (signal.aborted) return err({ code: "aborted" });
	if (!authorized(opts, input)) return err({ code: "stale" });
	const readers = captureSkillRuntimeReaders(opts);
	if (!readers.ok) return readers;
	const inspection = await prepare(readers.value, input, signal);
	if (signal.aborted) return err({ code: "aborted" });
	if (!authorized(opts, input) || !readers.value.current())
		return err({ code: "stale" });
	if (!inspection.ok) return inspection;
	try {
		return commit(opts, input, inspection.value);
	} catch {
		return err({ code: "storage_failed" });
	}
};
