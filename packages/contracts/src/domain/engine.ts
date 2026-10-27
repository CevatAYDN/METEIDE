import { z } from "zod";
import { type ModelRef, ModelRefSchema } from "./llm.js";
import type { Result } from "./result.js";
import {
	DecisionSchema,
	type PauseReasonSchema,
	type RunStatusSchema,
} from "./states.js";
import type { Transcript } from "./transcript.js";

// team.engine@2 from docs/06 (Kernel API); run states in docs/07, single-agent and team rules in docs/08.

/** A run's state (docs/07, Run state machine). */
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** A preferred model per role (team run) or for the single agent (ADR-122). */
export const RunPreferSchema = z.union([
	ModelRefSchema,
	z.record(z.string().min(1), ModelRefSchema),
]);
export type RunPrefer = z.infer<typeof RunPreferSchema>;

/** What starts a run; a templateId is refused until the team engine (Phase 2). */
export const RunStartSchema = z
	.strictObject({
		goal: z.string().trim().min(1).optional(),
		templateId: z.string().min(1).nullable().optional(),
		priority: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
		// Take the newest open handoff (docs/08, Run memory); the goal then defaults to its goal.
		continue: z.literal(true).optional(),
		// Per-run model preference: single agent or per role (ADR-122).
		prefer: RunPreferSchema.optional(),
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
	/** The run's model choice (ADR-122), when one run is asked (ADR-125). */
	readonly prefer?: RunPrefer;
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
	/** Sets or clears a run-specific model preference (null clears) (ADR-122). */
	model?(
		runId: string,
		model: ModelRef | null,
		roleId?: string,
	): Promise<Result<void, EngineError>>;
	/** The steps of the run's saved conversation, masked when read (ADR-125). */
	transcript?(runId: string): Promise<Result<Transcript, EngineError>>;
}
