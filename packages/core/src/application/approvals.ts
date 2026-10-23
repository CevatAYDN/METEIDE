import {
	type ApprovalInput,
	ApprovalInputSchema,
	type EngineError,
	err,
	ok,
	type Result,
} from "@mete/contracts";
import { z } from "zod";
import {
	decide,
	type TeamState,
	waitingForHuman,
	waitsToMerge,
} from "../domain/team.js";
import { taskConversation } from "../domain/team-run.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	platformOf,
} from "./run-state.js";
import { afterApproval } from "./spawned.js";

// The human's decision on a team task (team.engine@2 approve, docs/08 Task execution sequence,
// step 7). The engine resumes the run afterwards.

const invalid = (l: Live, message: string): Result<never, EngineError> =>
	err({ code: "invalid_state", message, status: l.snapshot.value });

// Why a decision on this task is refused.
const refusal = (team: TeamState, id: string) =>
	waitsToMerge(team, id)
		? `task ${id} is approved and waits for its merge: approve it to try the merge again`
		: `task ${id} does not wait for you`;

// A task named by its template id or its Task id; without one, the only task that waits.
const pick = (
	team: TeamState,
	taskId: string | undefined,
): Result<string, EngineError> => {
	if (taskId !== undefined) {
		const found = Object.entries(team.tasks).find(
			([id, entry]) => id === taskId || entry.id === taskId,
		);
		return found
			? ok(found[0])
			: err({ code: "not_found", message: `no task ${taskId}` });
	}
	const waiting = waitingForHuman(team);
	if (waiting.length === 1 && waiting[0]) return ok(waiting[0]);
	const names = waiting.join(", ") || "none";
	return err({
		code: "bad_input",
		message: `name the task; waiting for you: ${names}`,
	});
};

// A task the decision sent back to work opens its conversation with the human's instruction.
const goOn = (
	s: EngineState,
	l: Live,
	team: TeamState,
	id: string,
): Result<void, EngineError> => {
	if (team.tasks[id]?.status !== "in_progress") {
		apply(s, l, { type: "TEAM", team });
		return ok(undefined);
	}
	const where = platformOf(s);
	if (!where.ok)
		return err({
			code: "bad_input",
			message: `${where.error.file}: ${where.error.reason}`,
		});
	const messages = taskConversation(team, id, l.snapshot.context, where.value);
	apply(s, l, { type: "SWITCH", task: id, team, messages });
	return ok(undefined);
};

/** Records the human's decision on a run paused for approval; the caller resumes it. */
export const recordDecision = (
	s: EngineState,
	l: Live,
	input: ApprovalInput,
): Result<void, EngineError> => {
	const a = ApprovalInputSchema.safeParse(input);
	if (!a.success)
		return err({ code: "bad_input", message: z.prettifyError(a.error) });
	const c = l.snapshot.context;
	if (l.snapshot.value !== "paused" || c.pause?.reason !== "approval")
		return invalid(
			l,
			`the run is ${l.snapshot.value}, not paused for approval`,
		);
	if (!c.team) return invalid(l, "a single-agent run has no tasks to approve");
	const id = pick(c.team, a.data.taskId);
	if (!id.ok) return id;
	const r = decide(c.team, id.value, a.data);
	if (!r) return invalid(l, refusal(c.team, id.value));
	const after = afterApproval(s, l, r.team, id.value);
	const applied = goOn(s, l, after.team, id.value);
	if (!applied.ok) return applied;
	const taskId = c.team.tasks[id.value]?.id;
	const { decision, feedback } = a.data;
	const payload = {
		approver: "human",
		decision,
		...(feedback ? { feedback } : {}),
	};
	emit(s, l, { type: "approval.resolved", payload }, taskId);
	if (r.change)
		emit(s, l, { type: "task.status.changed", payload: r.change }, taskId);
	after.announce();
	return ok(undefined);
};
