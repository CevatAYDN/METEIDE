import { z } from "zod";
import type { Result } from "./result.js";
import type { PauseReasonSchema, RunStatusSchema } from "./states.js";

// team.engine@1 from docs/06 (Kernel API); run states in docs/07, single-agent rules in docs/08.

/** A run's state (docs/07, Run state machine). */
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** What starts a run; a templateId is refused until the team engine (Phase 2). */
export const RunStartSchema = z.strictObject({
	goal: z.string().trim().min(1),
	templateId: z.string().min(1).nullable().optional(),
	priority: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
});

/** What starts a run. */
export type RunStart = z.input<typeof RunStartSchema>;

/** A run as `status` shows it: the Run entity of docs/07 without its snapshot. */
export type RunView = {
	readonly id: string;
	readonly workspaceId: string;
	readonly templateId: string | null;
	readonly goal: string;
	readonly status: RunStatus;
	readonly pauseReason?: z.infer<typeof PauseReasonSchema>;
	readonly autonomyLevel: 0 | 1 | 2 | 3;
	readonly budget: {
		readonly cloudRequests: number;
		readonly maxHours: number;
	};
	readonly createdAt: string;
	readonly startedAt?: string;
	readonly endedAt?: string;
};

/** Why an engine call was refused. */
export type EngineError =
	| {
			readonly code: "bad_input" | "not_found" | "not_supported";
			readonly message: string;
	  }
	| {
			readonly code: "invalid_state";
			readonly message: string;
			readonly status: RunStatus;
	  };

/** team.engine@1: starts and steers runs; observers read the run.* and agent.* events. */
export interface TeamEngineAdapter {
	start(req: RunStart): Promise<Result<{ runId: string }, EngineError>>;
	pause(runId: string): Promise<Result<void, EngineError>>;
	resume(runId: string): Promise<Result<void, EngineError>>;
	cancel(runId: string): Promise<Result<void, EngineError>>;
	status(runId?: string): Result<RunView[], EngineError>;
}
