import {
	err,
	ok,
	type Result,
	type SkillOwner,
	type SkillRuntimeError,
	type SkillSnapshot,
} from "@mete/contracts";
import {
	type RunSkillState,
	RunSkillStateSchema,
	type SkillContextState,
} from "./skill-state.js";

const sameOwner = (a: SkillOwner, b: SkillOwner) =>
	a.runId === b.runId &&
	a.contextId === b.contextId &&
	a.taskId === b.taskId &&
	a.attemptId === b.attemptId;

/** The retained context of an owner, if it already exists. */
export const contextOf = (
	state: RunSkillState,
	owner: SkillOwner,
): SkillContextState | undefined =>
	state.contexts.find((context) => sameOwner(context.owner, owner));

const encoder = new TextEncoder();

/** Masked bytes and count already retained by a context; the loader adds to these. */
export const retainedOf = (context: SkillContextState | undefined) => ({
	count: context?.snapshots.length ?? 0,
	bytes:
		context?.snapshots.reduce(
			(total, { inspection }) =>
				total + encoder.encode(inspection.text).byteLength,
			0,
		) ?? 0,
});

/**
 * Pure next state with one more snapshot. The whole run state is re-validated, so an
 * owner, order or duplicate violation is an integrity failure rather than a silent write.
 */
export const withSnapshot = (
	state: RunSkillState,
	roleId: string,
	snapshot: SkillSnapshot,
): Result<RunSkillState, SkillRuntimeError> => {
	const existing = contextOf(state, snapshot.owner);
	const contexts = existing
		? state.contexts.map((context) =>
				context === existing
					? { ...context, snapshots: [...context.snapshots, snapshot] }
					: context,
			)
		: [
				...state.contexts,
				{ owner: snapshot.owner, roleId, snapshots: [snapshot] },
			];
	const next = RunSkillStateSchema.safeParse({ ...state, contexts });
	return next.success
		? ok(next.data)
		: err({
				code: "integrity_failed",
				sourceId: snapshot.inspection.source.sourceId,
			});
};
