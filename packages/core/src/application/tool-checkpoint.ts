import {
	apply,
	type EngineState,
	emit,
	type Live,
	toolContext,
} from "./run-state.js";
import { masked } from "./steps.js";
import { createCheckpoint } from "./vcs-steps.js";

// A tool step's checkpoint and file snapshot (ADR-080), before the tool can change the workspace.

const checkpointEvent = (step: number, snapshot?: string) => ({
	type: "CHECKPOINTED" as const,
	step,
	...(snapshot ? { snapshot } : {}),
});

// Without git, the step's file snapshot (ADR-080); none when the engine keeps no snapshots.
const openSnapshot = async (s: EngineState, l: Live, step: number) => {
	if (!s.deps.snapshots) return undefined;
	const opened = await s.deps.snapshots.open(l.meta.id, step);
	if (opened.ok)
		emit(s, l, {
			type: "checkpoint.created",
			payload: { kind: "snapshot", ref: opened.value },
		});
	return opened;
};

/** false when the checkpoint failed or the run stopped while it was made. */
export const checkpoint = async (
	s: EngineState,
	l: Live,
	owns: () => boolean,
	step: number,
) => {
	const cp = await createCheckpoint(s.deps, {
		...toolContext(l),
		runId: l.meta.id,
	});
	if (!cp.ok) {
		const at = s.deps.now();
		const message = await masked(s.deps, cp.error);
		const fail = { code: "checkpoint_failed", message };
		if (owns()) apply(s, l, { type: "FAIL", at, ...fail });
		return false;
	}
	if (cp.value)
		emit(s, l, {
			type: "checkpoint.created",
			payload: { kind: "git", ref: cp.value },
		});
	const snapshot = cp.value ? undefined : await openSnapshot(s, l, step);
	if (snapshot && !snapshot.ok) {
		const fail = { code: "checkpoint_failed", message: snapshot.error.message };
		if (owns()) apply(s, l, { type: "FAIL", at: s.deps.now(), ...fail });
		return false;
	}
	return apply(s, l, checkpointEvent(step, snapshot?.value)) && owns();
};

/** Copies a file into the step's snapshot before an fs tool writes it (ADR-080). */
export const keeping = (s: EngineState, l: Live) => {
	const ref = l.snapshot.context.snapshot;
	const store = s.deps.snapshots;
	return ref && store ? (path: string) => store.keep(ref, path) : undefined;
};
