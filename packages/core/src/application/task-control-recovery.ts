import type { PolicyRequestsAdapter } from "@mete/contracts";
import { currentWait } from "../domain/task-wait.js";
import { apply, type EngineState, type Live } from "./run-state.js";
import { setTaskWait, waitIdentity } from "./task-waits.js";

/** Process-local policy permissions never survive a recovered run. */
export const forgetPolicyRequests = (state: EngineState, runId: string) => {
	const port =
		state.deps.registry.resolve<PolicyRequestsAdapter>("policy.requests@1");
	if (!port.ok) return;
	const result = port.value[0].impl.forget({ runId });
	if (!result.ok)
		state.deps.logger.warn(
			{ runId, code: result.error.code },
			"policy requests could not be retired",
		);
};

const recoverWaits = (state: EngineState, live: Live) => {
	const team = live.snapshot.context.team;
	if (!team) return;
	const tasks = { ...team.tasks };
	let changed = false;
	for (const [id, entry] of Object.entries(tasks)) {
		if (entry.wait?.request.kind === "policy") {
			tasks[id] = { ...entry, wait: undefined };
			changed = true;
		}
		if (entry.setup === "running") {
			tasks[id] = { ...entry, wait: undefined, setup: "uncertain" };
			changed = true;
		}
	}
	if (changed) apply(state, live, { type: "TEAM", team: { ...team, tasks } });
	for (const [task, entry] of Object.entries(tasks))
		if (entry.setup === "uncertain") holdInterruptedSetup(state, live, task);
};

/** A stopped setup call is never re-executed merely because the run resumes. */
export const holdInterruptedSetup = (
	state: EngineState,
	live: Live,
	task: string,
) => {
	const team = live.snapshot.context.team;
	const entry = team?.tasks[task];
	if (!team || !entry || currentWait(entry)) return;
	apply(state, live, {
		type: "TEAM",
		team: {
			...team,
			tasks: { ...team.tasks, [task]: { ...entry, setup: "uncertain" } },
		},
	});
	setTaskWait(state, live, task, {
		stage: "setup",
		request: {
			...waitIdentity(live, task),
			requestId: state.deps.newId(),
			kind: "blocked",
			reason: "setup_interrupted",
		},
	});
};

/** Invalidates old policy challenges and prevents implicit replay of interrupted setup. */
export const recoverTaskControls = (state: EngineState) => {
	for (const live of state.live.values()) {
		if (!["running", "paused"].includes(live.snapshot.value)) continue;
		forgetPolicyRequests(state, live.meta.id);
		recoverWaits(state, live);
	}
};
