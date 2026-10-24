import {
	type CheckpointRestoreAdapter,
	type CheckpointRestored,
	type CheckpointRestoreError,
	err,
	type MeteEvent,
	type Result,
} from "@mete/contracts";
import type { App } from "../infrastructure/app.js";
import { runHistory } from "../infrastructure/history.js";
import { type Io, withEngine } from "./commands.js";

// Restoring a checkpoint (ADR-079): core-engine reads no events, so the composition root finds the
// run's checkpoint.created event in its history and passes the event's id and ref to
// checkpoint.restore@1. The daemon picks the event by id, `mete rollback` by the ref's number.

type CheckpointCreated = Extract<MeteEvent, { type: "checkpoint.created" }>;

/** Why nothing was restored: a refusal of checkpoint.restore@1, or no storage to read from. */
export type RollbackError =
	| CheckpointRestoreError
	| { readonly code: "no_storage"; readonly message: string };

/** Restores the checkpoint of the run that `pick` chooses among its checkpoint.created events. */
export const restoreCheckpoint = async (
	app: App,
	runId: string,
	pick: (e: CheckpointCreated) => boolean,
): Promise<Result<CheckpointRestored, RollbackError>> => {
	const restore = app.registry.resolve<CheckpointRestoreAdapter>(
		"checkpoint.restore@1",
	);
	if (!restore.ok)
		return err({ code: "failed", message: "core-engine is not active" });
	const history = runHistory(app.registry, runId);
	if (!history)
		return err({ code: "no_storage", message: "storage is not active" });
	const found = history.events.find(
		(e): e is CheckpointCreated => e.type === "checkpoint.created" && pick(e),
	);
	if (!found)
		return err({
			code: "not_found",
			message: `no such checkpoint in ${runId}`,
		});
	return restore.value[0].impl.restore({
		runId,
		checkpointId: found.id,
		ref: found.payload.ref,
	});
};

/** A checkpoint ref's number: refs/mete/checkpoints/<run id>/<n>. */
const numberOf = (ref: string) => ref.slice(ref.lastIndexOf("/") + 1);

/** `mete rollback <run id> <n>`: restores the run's checkpoint n and says how to undo it. */
export const rollbackCommand = (app: App, io: Io, runId: string, n: string) =>
	withEngine(app, io, async () => {
		if (!/^[1-9]\d*$/.test(n)) {
			io.err(`${n} is not a checkpoint number (1, 2, 3, ...)`);
			return 1;
		}
		const r = await restoreCheckpoint(
			app,
			runId,
			(e) => numberOf(e.payload.ref) === n,
		);
		if (!r.ok) {
			io.err(`${r.error.code}: ${r.error.message}`);
			return 1;
		}
		io.out(`restored ${r.value.ref}`);
		io.out(`undo with: mete rollback ${runId} ${numberOf(r.value.undo)}`);
		return 0;
	});
