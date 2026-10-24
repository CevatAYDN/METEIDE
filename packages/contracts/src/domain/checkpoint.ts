import type { Result } from "./result.js";

// checkpoint.restore@1 from ADR-079 (SECURITY.md, Checkpoints and rollback): restores a run's git
// checkpoint while the run is paused or ended, recording the current state first.

/**
 * Which checkpoint to restore: the id of its `checkpoint.created` event and that event's `ref`,
 * which the composition root reads from the run's history; core refuses a ref outside
 * `refs/mete/checkpoints/<runId>/`.
 */
export type CheckpointRestoreInput = {
	readonly runId: string;
	readonly checkpointId: string;
	readonly ref: string;
};

/** The ref restored, and the checkpoint of the state before it, which undoes the restore. */
export type CheckpointRestored = {
	readonly ref: string;
	readonly undo: string;
};

/**
 * Why a restore did not happen: an unknown run or a ref git no longer has (`not_found`), a run not
 * paused or ended (`run_active`), no `vcs.git@2` (`no_vcs`), a ref of another run (`invalid`), or git
 * failed (`failed`).
 */
export type CheckpointRestoreError = {
	readonly code: "not_found" | "run_active" | "no_vcs" | "invalid" | "failed";
	readonly message: string;
};

/** The checkpoint.restore@1 adapter; a restore publishes `rollback.performed { checkpointId }`. */
export interface CheckpointRestoreAdapter {
	restore(
		input: CheckpointRestoreInput,
	): Promise<Result<CheckpointRestored, CheckpointRestoreError>>;
}
