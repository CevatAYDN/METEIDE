import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	err,
	ok,
	type Result,
	SkillApproveInputSchema,
	type SkillError,
	type SkillInspection,
	type SkillPreview,
	SkillPreviewSchema,
	type SkillSourceDescriptor,
	type SkillSourceInput,
	SkillSourceInputSchema,
} from "@mete/contracts";
import { SKILL_PREVIEW_LIMIT, SKILL_PREVIEW_TTL_MS } from "../defaults.js";
import {
	inspectCurrentSkill,
	readSkillInventory,
	type SkillInventory,
} from "./skill-evidence.js";
import {
	captureSkillReaders,
	maskSkillInspection,
	type SkillReaders,
	skillFailure,
} from "./skill-readers.js";
import type { SkillStatusOptions } from "./skill-status.js";

/** Private retained authority; no raw or masked body is retained here or written to storage. */
export type PendingSkillPreview = {
	readonly source: SkillSourceDescriptor;
	readonly sha256: string;
	readonly maskedSha256: string;
	readonly revision: number;
	readonly readers: SkillReaders;
	readonly expiresAt: number;
};
/** A module instance owns one workspace's preview collection and optional test clock. */
export type SkillPreviewOptions = SkillStatusOptions & {
	readonly now?: () => number;
};
type State = {
	pending: Map<string, PendingSkillPreview>;
	preparing: number;
	closed: boolean;
	now: () => number;
};

/** Stable JSON digest of the masked inspection, distinct from its retained raw-file sha256. */
export const maskedInspectionDigest = (inspection: SkillInspection) =>
	createHash("sha256")
		.update(
			JSON.stringify(inspection, (_key, value: unknown) =>
				value && typeof value === "object" && !Array.isArray(value)
					? Object.fromEntries(
							Object.entries(value).sort(([a], [b]) =>
								a < b ? -1 : a > b ? 1 : 0,
							),
						)
					: value,
			),
		)
		.digest("hex");

const selectPreviewSource = (inventory: SkillInventory, sourceId: string) => {
	const source = inventory.sources.sources.find((s) => s.sourceId === sourceId);
	if (!source) return skillFailure("not_found");
	const diagnostic = [
		...inventory.sources.diagnostics,
		...inventory.catalog.diagnostics,
	].find((d) => d.sourceId === sourceId);
	if (diagnostic) return err(diagnostic);
	if (!inventory.catalog.entries.some((e) => e.source.sourceId === sourceId))
		return skillFailure();
	return ok(source);
};
const review = async (
	opts: SkillPreviewOptions,
	r: SkillReaders,
	input: SkillSourceInput,
	signal: AbortSignal,
) => {
	const inventory = await readSkillInventory(r, signal);
	if (!inventory.ok) return inventory;
	const selected = selectPreviewSource(inventory.value, input.sourceId);
	if (!selected.ok) return selected;
	const source = selected.value;
	const before = opts.grants.read(input.sourceId);
	if (!before.ok) return before;
	if (before.value && !isDeepStrictEqual(before.value.source, source))
		return skillFailure("stale");
	const inspected = await inspectCurrentSkill(r, source, signal);
	if (!inspected.ok) return inspected;
	const masked = await maskSkillInspection(r, inspected.value, signal);
	if (!masked.ok) return masked;
	const after = opts.grants.read(input.sourceId);
	if (!after.ok) return after;
	if (!isDeepStrictEqual(before.value, after.value))
		return skillFailure("stale");
	return ok({
		source,
		inspection: masked.value,
		revision: after.value?.revision ?? 0,
	});
};
const retain = (
	opts: SkillPreviewOptions,
	state: State,
	readers: SkillReaders,
	reviewed: {
		source: SkillSourceDescriptor;
		inspection: SkillInspection;
		revision: number;
	},
): Result<SkillPreview, SkillError> => {
	const grant = opts.grants.read(reviewed.source.sourceId);
	if (!grant.ok) return grant;
	if ((grant.value?.revision ?? 0) !== reviewed.revision)
		return skillFailure("stale");
	if (state.closed) return skillFailure();
	if (!readers.current()) return skillFailure("stale");
	const expiresAt = state.now() + SKILL_PREVIEW_TTL_MS;
	const preview = SkillPreviewSchema.safeParse({
		previewId: randomUUID(),
		inspection: reviewed.inspection,
		expiresAt: new Date(expiresAt).toISOString(),
		revision: reviewed.revision,
	});
	if (!preview.success) return skillFailure();
	state.pending.set(
		preview.data.previewId,
		Object.freeze({
			source: Object.freeze({ ...reviewed.source }),
			sha256: reviewed.inspection.sha256,
			maskedSha256: maskedInspectionDigest(reviewed.inspection),
			revision: reviewed.revision,
			readers,
			expiresAt,
		}),
	);
	return ok(preview.data);
};
const reservePreview = (
	state: State,
	raw: SkillSourceInput,
	signal: AbortSignal,
) => {
	const input = SkillSourceInputSchema.safeParse(raw);
	if (!input.success) return skillFailure("bad_input");
	if (signal.aborted) return skillFailure("aborted");
	if (state.closed) return skillFailure();
	for (const [id, entry] of state.pending) {
		if (entry.expiresAt <= state.now()) state.pending.delete(id);
	}
	if (state.pending.size + state.preparing >= SKILL_PREVIEW_LIMIT)
		return skillFailure("limit_exceeded");
	state.preparing++;
	return ok(input.data);
};
const prepare = async (
	opts: SkillPreviewOptions,
	state: State,
	raw: SkillSourceInput,
	signal: AbortSignal,
): Promise<Result<SkillPreview, SkillError>> => {
	let reserved = false;
	try {
		const input = reservePreview(state, raw, signal);
		if (!input.ok) return input;
		reserved = true;
		const captured = captureSkillReaders(opts);
		if (!captured.ok) return captured;
		const reviewed = await review(opts, captured.value, input.value, signal);
		if (signal.aborted) return skillFailure("aborted");
		return reviewed.ok
			? retain(opts, state, captured.value, reviewed.value)
			: reviewed;
	} catch {
		return skillFailure(signal.aborted ? "aborted" : "unavailable");
	} finally {
		if (reserved) state.preparing--;
	}
};
const consume = (
	state: State,
	previewId: string,
): Result<PendingSkillPreview, SkillError> => {
	try {
		if (!SkillApproveInputSchema.safeParse({ previewId }).success)
			return skillFailure("bad_input");
		const entry = state.pending.get(previewId);
		state.pending.delete(previewId);
		if (!entry || state.closed) return skillFailure("not_found");
		if (entry.expiresAt <= state.now()) return skillFailure("expired");
		return entry.readers.current() ? ok(entry) : skillFailure("stale");
	} catch {
		return skillFailure();
	}
};

/** Read-only preparation; future mutations must recheck consumed entries after admission. */
export const createSkillPreviews = (opts: SkillPreviewOptions) => {
	const state: State = {
		pending: new Map(),
		preparing: 0,
		closed: false,
		now: opts.now ?? Date.now,
	};
	return {
		prepare: (input: SkillSourceInput, signal: AbortSignal) =>
			prepare(opts, state, input, signal),
		consume: (previewId: string) => consume(state, previewId),
		clear: () => {
			state.closed = true;
			state.pending.clear();
		},
	};
};
