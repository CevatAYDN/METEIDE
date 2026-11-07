import {
	type EngineError,
	err,
	ok,
	PolicySchema,
	type Result,
} from "@mete/contracts";
import type { ConfigInvalid } from "@mete/kernel";
import type { Budget } from "../domain/next-step.js";
import type { TeamState } from "../domain/team.js";
import type { EngineState } from "./run-state.js";

/** Converts invalid configuration into the engine's expected input failure. */
export const fromConfig = (e: ConfigInvalid): EngineError => ({
	code: "bad_input",
	message: `${e.file}: ${e.path}: ${e.reason}`,
});

/** A template never raises the policy's autonomy or budget (SECURITY.md). */
export const policy = (
	s: EngineState,
	team?: TeamState,
): Result<{ autonomy: 0 | 1 | 2 | 3; budget: Budget }, EngineError> => {
	const p = s.deps.config.get("policy", PolicySchema);
	if (!p.ok) return err(fromConfig(p.error));
	const b = p.value.budget;
	const t = team?.template.budget;
	const budget = {
		cloudRequests: Math.min(
			b.cloud_requests_per_run,
			t?.cloud_requests ?? Infinity,
		),
		maxHours: Math.min(b.max_hours, t?.max_hours ?? Infinity),
	};
	return ok({ autonomy: p.value.autonomy, budget });
};
