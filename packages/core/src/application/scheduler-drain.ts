import { err, ok } from "@mete/contracts";
import type { Pending, Scheduler } from "./parallel-scheduler.js";
import type { EngineState, Live } from "./run-state.js";
import { settleWorker } from "./worker-result.js";
import { settleWorkerTool } from "./worker-tool.js";

const settlePending = (
	state: EngineState,
	live: Live,
	pending: Pending,
	drain: boolean,
) => {
	try {
		if (pending.kind === "tool")
			settleWorkerTool(state, live, pending.call, drain);
		else settleWorker(state, live, pending.call);
		return ok(undefined);
	} catch (error) {
		state.deps.logger.error(
			{
				failure: "unexpected_settlement_error",
				runId: live.meta.id,
				task: pending.call.task,
				...pending.call.as,
			},
			"scheduler call settlement threw",
		);
		return err(error);
	}
};

/** Retires every buffered call, reporting errors only after every peer has settled. */
export const stopScheduler = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
) => {
	const drain = scheduler.model.signal.aborted;
	scheduler.model.abort();
	const calls = [...scheduler.pending.values()];
	const waited = await Promise.allSettled(calls.map(({ call }) => call.wait));
	const errors: unknown[] = [];
	for (const [index, pending] of calls.entries()) {
		const result = waited[index];
		if (result?.status === "rejected") {
			errors.push(result.reason);
			state.deps.logger.error(
				{
					failure: "unexpected_wait_error",
					runId: live.meta.id,
					task: pending.call.task,
					...pending.call.as,
				},
				"scheduler call wait threw",
			);
		}
		const settled = settlePending(state, live, pending, drain);
		if (!settled.ok) errors.push(settled.error);
	}
	scheduler.pending.clear();
	if (errors.length > 0)
		throw new AggregateError(errors, "scheduler drain failed");
};
