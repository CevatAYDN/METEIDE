import type { EngineState, Live } from "./run-state.js";
import { syncHumanWaits } from "./task-waits.js";
import { interruptVerification } from "./verification.js";
import { blockVerification } from "./verification-driver.js";

/** Running gates left by a crash become uncertain evidence; resume never dispatches them. */
export const recoverVerification = (state: EngineState, live: Live) => {
	if (!["running", "paused"].includes(live.snapshot.value)) return;
	const team = live.snapshot.context.team;
	if (team?.verificationVersion !== 1) return;
	for (const task of Object.keys(team.tasks)) {
		interruptVerification(state, live, task);
		if (
			live.snapshot.context.team?.tasks[task]?.verification?.gates.some(
				(row) => row.status === "not_run" && row.reason === "interrupted",
			)
		)
			blockVerification(state, live, task);
	}
	syncHumanWaits(state, live);
};
