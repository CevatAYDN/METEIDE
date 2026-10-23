import type { VcsGitAdapter } from "@mete/contracts";
import { CHECKPOINT_KEEP_DAYS } from "../defaults.js";
import type { EngineDeps } from "./run-state.js";

// Checkpoints are kept 14 days after the run ends (SECURITY.md, Checkpoints and rollback): at
// start, the process that drives runs removes the checkpoint refs of runs that ended earlier.
// Without vcs.git@2 there is nothing to remove. A run already swept has no refs left, and pruning
// it again removes none, so sweeping at every start needs no record of what was swept.
// shortcut: git checkpoints only; file snapshots and their folder come with snapshots (Phase 5).

const DAY_MS = 86_400_000;
// Only bounds a git call that hangs; a prune of a few refs takes milliseconds.
const PRUNE_TIMEOUT_MS = 30_000;

/** Removes the checkpoints of the runs that ended more than CHECKPOINT_KEEP_DAYS ago. */
export const pruneOldCheckpoints = async (
	deps: Pick<EngineDeps, "registry" | "store" | "now" | "logger">,
): Promise<void> => {
	const vcs = deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
	if (!vcs.ok) return;
	const before = new Date(
		deps.now() - CHECKPOINT_KEEP_DAYS * DAY_MS,
	).toISOString();
	for (const runId of deps.store.endedBefore(before)) {
		const r = await vcs.value[0].impl.run(
			{ op: "checkpoint.prune", runId },
			{ runId, signal: AbortSignal.timeout(PRUNE_TIMEOUT_MS) },
		);
		if (!r.ok)
			deps.logger.warn(
				{ runId, reason: r.error.message },
				"checkpoints not pruned",
			);
	}
};
