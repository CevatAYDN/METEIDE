import { z } from "zod";
import type { Result } from "./result.js";
import {
	DecisionSchema,
	type PauseReasonSchema,
	type RunStatusSchema,
} from "./states.js";

// team.engine@2 from docs/06 (Kernel API); run states in docs/07, single-agent and team rules in docs/08.

/** A run's state (docs/07, Run state machine). */
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** What starts a run; a templateId is refused until the team engine (Phase 2). */
export const RunStartSchema = z
	.strictObject({
		goal: z.string().trim().min(1).optional(),
		templateId: z.string().min(1).nullable().optional(),
		priority: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
		// Take the newest open handoff (docs/08, Run memory); the goal then defaults to its goal.
		continue: z.literal(true).optional(),
	})
	.refine((r) => r.goal !== undefined || r.continue === true, {
		message: "a goal is needed unless the run continues a handoff",
		path: ["goal"],
	});

/** What starts a run. */
export type RunStart = z.input<typeof RunStartSchema>;

/**
 * The human's decision on a task that waits for them (docs/08): a submission in human_checkpoints
 * or with approval: human, or a blocked task. Without taskId it is the only task that waits.
 */
export const ApprovalInputSchema = z
	.strictObject({
		taskId: z.string().min(1).optional(),
		decision: DecisionSchema,
		feedback: z.string().trim().min(1).optional(),
	})
	.refine((a) => a.decision === "approve" || a.feedback !== undefined, {
		message: "a revision needs feedback",
		path: ["feedback"],
	});

/** The human's decision on a waiting task. */
export type ApprovalInput = z.input<typeof ApprovalInputSchema>;

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
	  }
	| {
			/** The router was unsure (docs/08, Router): no run started; the user picks one. */
			readonly code: "choose_template";
			readonly message: string;
			readonly suggestions: readonly string[];
	  };

/** team.engine@2: starts and steers runs; observers read the run.*, task.* and agent.* events. */
export interface TeamEngineAdapter {
	start(req: RunStart): Promise<Result<{ runId: string }, EngineError>>;
	pause(runId: string): Promise<Result<void, EngineError>>;
	resume(runId: string): Promise<Result<void, EngineError>>;
	cancel(runId: string): Promise<Result<void, EngineError>>;
	/** Records the human's decision on a run paused for approval, then resumes it (team.engine@2). */
	approve(
		runId: string,
		input: ApprovalInput,
	): Promise<Result<void, EngineError>>;
	status(runId?: string): Result<RunView[], EngineError>;
}
