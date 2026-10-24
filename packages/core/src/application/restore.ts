import {
	type CheckpointRestoreAdapter,
	type CheckpointRestoreError,
	type CheckpointRestoreInput,
	err,
	ok,
	type VcsGitAdapter,
} from "@mete/contracts";
import type { EventBody } from "../domain/run-events.js";
import { type EngineDeps, iso } from "./run-state.js";

// checkpoint.restore@1 (ADR-079): restores a run's git checkpoint while the run is paused or ended.
// The composition root reads the run's history and passes the ref of the checkpoint.created event;
// the ref must lie under the run's own checkpoints. The current state is recorded first, so the
// restore is itself undone by restoring that checkpoint. Only files change, never the run.

type Deps = Pick<
	EngineDeps,
	"registry" | "store" | "events" | "now" | "newId" | "workspaceId"
>;

// Only bounds a git call that hangs; a checkpoint and a restore take seconds on a large tree.
const GIT_TIMEOUT_MS = 120_000;

const STILL = new Set(["paused", "completed", "failed", "cancelled"]);

const fail = (code: CheckpointRestoreError["code"], message: string) =>
	err<CheckpointRestoreError>({ code, message });

// A run that ended has no Live, so the events are published here rather than through emit().
const publish = (deps: Deps, runId: string, body: EventBody) =>
	deps.events.publish({
		id: deps.newId(),
		ts: iso(deps.now()),
		schema: 1,
		workspaceId: deps.workspaceId,
		runId,
		source: "core-engine",
		...body,
	});

// The checks before git is touched: the ref is the run's, the run exists and stands still.
const refused = (deps: Deps, { runId, ref }: CheckpointRestoreInput) => {
	if (!ref.startsWith(`refs/mete/checkpoints/${runId}/`))
		return fail("invalid", `${ref} is not a checkpoint of run ${runId}`);
	const [run] = deps.store.list(runId);
	if (!run) return fail("not_found", `no run ${runId}`);
	if (!STILL.has(run.status))
		return fail("run_active", `run ${runId} is ${run.status}`);
	return undefined;
};

// Records the state now as the undo checkpoint, then restores the ref.
const rollBack = async (
	deps: Deps,
	git: VcsGitAdapter,
	{ runId, checkpointId, ref }: CheckpointRestoreInput,
) => {
	const ctx = { runId, signal: AbortSignal.timeout(GIT_TIMEOUT_MS) };
	const made = await git.run({ op: "checkpoint.create", runId }, ctx);
	if (!made.ok) return fail("failed", made.error.message);
	if (made.value.op !== "checkpoint.create")
		return fail("failed", `unexpected ${made.value.op} result`);
	const undo = made.value.ref;
	publish(deps, runId, {
		type: "checkpoint.created",
		payload: { kind: "git", ref: undo },
	});
	const back = await git.run({ op: "checkpoint.restore", ref }, ctx);
	if (!back.ok)
		return fail(
			back.error.code === "not_found" ? "not_found" : "failed",
			back.error.message,
		);
	publish(deps, runId, {
		type: "rollback.performed",
		payload: { checkpointId },
	});
	return ok({ ref, undo });
};

/** Creates the checkpoint.restore@1 adapter on the engine's dependencies. */
export const createCheckpointRestore = (
	deps: Deps,
): CheckpointRestoreAdapter => ({
	restore: async (input) => {
		const no = refused(deps, input);
		if (no) return no;
		const vcs = deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
		if (!vcs.ok) return fail("no_vcs", "vcs.git@2 is not active");
		return rollBack(deps, vcs.value[0].impl, input);
	},
});
