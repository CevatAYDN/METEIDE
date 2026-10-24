import type { VcsGitAdapter } from "@mete/contracts";
import { CHECKPOINT_KEEP_DAYS } from "../defaults.js";
import type { EngineDeps } from "./run-state.js";

// Checkpoints are kept 14 days after the run ends (SECURITY.md, Checkpoints and rollback): at
// start, the process that drives runs removes the checkpoints of runs that ended earlier: their git
// refs through vcs.git@2 when it is active, and their file snapshots (ADR-080) whether it is or not.
// vcs-git activates before core-engine (it registers first and needs no more than core does), so
// the sweep finds it; apps/cli's retention test proves it end to end. A run already swept has
// nothing left, and pruning it again removes nothing, so sweeping at every start needs no record of
// what was swept.

const DAY_MS = 86_400_000;
// Only bounds a git call that hangs; a prune of a few refs takes milliseconds.
const PRUNE_TIMEOUT_MS = 30_000;

type Deps = Pick<
	EngineDeps,
	"registry" | "store" | "now" | "logger" | "snapshots"
>;

const pruneRefs = async (deps: Deps, vcs: VcsGitAdapter, runId: string) => {
	const r = await vcs.run(
		{ op: "checkpoint.prune", runId },
		{ runId, signal: AbortSignal.timeout(PRUNE_TIMEOUT_MS) },
	);
	if (!r.ok)
		deps.logger.warn(
			{ runId, reason: r.error.message },
			"checkpoints not pruned",
		);
};

const pruneSnapshots = async (deps: Deps, runId: string) => {
	try {
		await deps.snapshots?.prune(runId);
	} catch (e) {
		deps.logger.warn({ runId, reason: String(e) }, "snapshots not pruned");
	}
};

/** Removes the checkpoints of the runs that ended more than CHECKPOINT_KEEP_DAYS ago. */
export const pruneOldCheckpoints = async (deps: Deps): Promise<void> => {
	const vcs = deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
	const before = new Date(
		deps.now() - CHECKPOINT_KEEP_DAYS * DAY_MS,
	).toISOString();
	for (const runId of deps.store.endedBefore(before)) {
		if (vcs.ok) await pruneRefs(deps, vcs.value[0].impl, runId);
		await pruneSnapshots(deps, runId);
	}
};
