import type { NextStep } from "../domain/next-step.js";
import type { RunContext } from "../domain/run-machine.js";
import { currentWait } from "../domain/task-wait.js";
import { isAsking, verifyOf } from "../domain/team-run.js";
import type { EngineState, Live } from "./run-state.js";
import { holdInterruptedSetup } from "./task-control-recovery.js";
import { hasPendingSetup, runPendingSetup } from "./task-setup.js";

/** Missing setup belongs to legacy snapshots; only explicit unfinished setup blocks work. */
export const needsSetup = (
	entry: NonNullable<RunContext["team"]>["tasks"][string] | undefined,
) => entry?.setup !== undefined && entry.setup !== "done";

/** Verification can invoke unconfined tools, even when the final model reply has no calls. */
export const verifies = (context: RunContext, next: NextStep) =>
	next.kind === "complete" &&
	context.team &&
	context.task &&
	verifyOf(context.team, context.task).length > 0;

/** Setup owns the exclusive seat before either worker or clarification model work. */
export const setupStep = async (
	state: EngineState,
	live: Live,
	task: string,
	occupied: number,
) => {
	if (occupied > 0) return "exclusive";
	const entry = live.snapshot.context.team?.tasks[task];
	if (hasPendingSetup(entry)) await runPendingSetup(state, live, task);
	else holdInterruptedSetup(state, live, task);
	return "handled";
};

/** Human waits release the seat; active coordinator conversations respect setup and peer writes. */
export const coordinatorStep = async (
	state: EngineState,
	live: Live,
	occupied: number,
) => {
	const context = live.snapshot.context;
	const task = context.task;
	const entry = context.team?.tasks[task ?? ""];
	if (currentWait(entry)) return undefined;
	if (
		!(context.review || context.clarify || context.judge || isAsking(context))
	)
		return undefined;
	if (task && needsSetup(entry)) return setupStep(state, live, task, occupied);
	return "exclusive";
};
