import {
	err,
	ok,
	type Result,
	type SkillLoadOutput,
	type SkillOwner,
	type SkillRuntimeAdapter,
	type SkillRuntimeError,
	SkillRuntimeLoadResultSchema,
	type SkillSnapshot,
	type SkillVersion,
} from "@mete/contracts";
import {
	contextOf,
	retainedOf,
	withSnapshot,
} from "../domain/skill-context.js";
import type { RunSkillState } from "../domain/skill-state.js";
import type { SkillLoadAuthority } from "./skill-load-authority.js";

/** Everything a load needs, all supplied by native core, never by the model. */
export type SkillLoadRequest = {
	readonly owner: SkillOwner;
	readonly roleId: string;
	readonly version: SkillVersion;
	readonly origin: "explicit" | "model";
};

/**
 * The owning run, as the coordinator sees it. `owned` captures the drive, call and context
 * and must turn false forever once any of them ends; `commit` durably saves the new state.
 */
export type SkillLoadHost = {
	readonly runtime: () => SkillRuntimeAdapter | undefined;
	readonly authority: SkillLoadAuthority;
	readonly skills: () => RunSkillState | undefined;
	readonly owned: () => boolean;
	readonly commit: (next: RunSkillState, contextId: string) => boolean;
	readonly newId: () => string;
	readonly signal: AbortSignal;
};
type Loaded = Result<SkillLoadOutput, SkillRuntimeError>;

const acknowledgement = (snapshot: SkillSnapshot): SkillLoadOutput => ({
	receiptId: snapshot.receiptId,
	version: {
		sourceId: snapshot.inspection.source.sourceId,
		sha256: snapshot.inspection.sha256,
		revision: snapshot.revision,
	},
	origin: snapshot.origin,
	loadedAt: snapshot.loadedAt,
});

/** The retained exact version is reused, preserving its receipt, origin and loadedAt. */
const retained = (host: SkillLoadHost, req: SkillLoadRequest) => {
	const skills = host.skills();
	const context = skills && contextOf(skills, req.owner);
	return context?.snapshots.find(
		({ inspection, revision }) =>
			inspection.source.sourceId === req.version.sourceId &&
			inspection.sha256 === req.version.sha256 &&
			revision === req.version.revision,
	);
};

const callRuntime = async (
	runtime: SkillRuntimeAdapter,
	input: Parameters<SkillRuntimeAdapter["load"]>[0],
	signal: AbortSignal,
): Promise<Result<SkillSnapshot, SkillRuntimeError>> => {
	try {
		const parsed = SkillRuntimeLoadResultSchema.safeParse(
			await runtime.load(input, signal),
		);
		return parsed.success ? parsed.data : err({ code: "unavailable" });
	} catch {
		return err({ code: signal.aborted ? "aborted" : "unavailable" });
	}
};

/** Persists the snapshot in the owning run; success is reported only after the save. */
const commit = (
	host: SkillLoadHost,
	req: SkillLoadRequest,
	snapshot: SkillSnapshot,
): Loaded => {
	const skills = host.skills();
	if (!skills) return err({ code: "integrity_failed" });
	const next = withSnapshot(skills, req.roleId, snapshot);
	if (!next.ok) return next;
	try {
		if (!host.commit(next.value, req.owner.contextId))
			return err({ code: "stale" });
	} catch {
		return err({ code: "storage_failed" });
	}
	return ok(acknowledgement(snapshot));
};

const issue = async (
	host: SkillLoadHost,
	runtime: SkillRuntimeAdapter,
	req: SkillLoadRequest,
): Promise<Loaded> => {
	const skills = host.skills();
	const { bytes, count } = retainedOf(skills && contextOf(skills, req.owner));
	const input = {
		owner: req.owner,
		operationId: host.newId(),
		version: req.version,
		origin: req.origin,
	};
	const release = host.authority.begin({
		input,
		live: host.owned,
		retainedBytes: bytes,
		retainedCount: count,
	});
	try {
		const loaded = await callRuntime(runtime, input, host.signal);
		if (!loaded.ok) return loaded;
		if (!host.owned()) return err({ code: "stale" });
		return commit(host, req, loaded.value);
	} finally {
		release();
	}
};

/**
 * The single loading coordinator for explicit and model loads (ADR-190). A receipt orphaned by
 * cancellation or a failed save grants nothing; the run never sees unrecorded text.
 */
export const loadSkill = async (
	host: SkillLoadHost,
	req: SkillLoadRequest,
): Promise<Loaded> => {
	if (!host.owned()) return err({ code: "stale" });
	if (!host.skills()) return err({ code: "integrity_failed" });
	const reused = retained(host, req);
	if (reused) return ok(acknowledgement(reused));
	const runtime = host.runtime();
	return runtime ? issue(host, runtime, req) : err({ code: "unavailable" });
};
