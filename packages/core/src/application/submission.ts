import type { ChatMessage } from "@mete/contracts";
import type { TaskEvent } from "../domain/task-machine.js";
import {
	type ArtifactMeta,
	applyTask,
	keepMessages,
	type TaskChange,
	withArtifact,
} from "../domain/team.js";
import { guardrailOf } from "../domain/team-run.js";
import { eligibleVerification } from "../domain/verification.js";
import { announce, saveArtifact } from "./artifacts.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	stuck,
} from "./run-state.js";
import { refreshVerificationSnapshot } from "./verification.js";

// How a task's attempt ends (docs/08, Task execution sequence): submitted with its report kept as
// the task's artifact, or blocked, its conversation kept either way.

// Events name a task by its Task id, not by its template id.
export const changed = (
	s: EngineState,
	l: Live,
	taskId?: string,
	change?: TaskChange,
) => {
	if (change)
		emit(s, l, { type: "task.status.changed", payload: change }, taskId);
};

const refreshRunningAttempt = (s: EngineState, l: Live) => {
	if (l.snapshot.value !== "running") return false;
	const token = l.token;
	return !!refreshVerificationSnapshot(s, l) && l.token === token;
};

// Ends the attempt: its conversation (and Artifact) is kept and the task moves on. A best-of-N task
// keeps the conversation of the attempt that goes on, which may be an earlier one (ADR-162).
export const endAttempt = (
	s: EngineState,
	l: Live,
	event: TaskEvent,
	end: {
		readonly artifact?: ArtifactMeta | undefined;
		readonly messages?: readonly ChatMessage[];
	} = {},
) => {
	if (!refreshRunningAttempt(s, l)) return false;
	const { team, task, messages, turns, tainted } = l.snapshot.context;
	if (!team || !task) return stuck(s, l);
	if (
		event.type === "SUBMIT" &&
		!eligibleVerification(team, task, event.report)
	)
		return false;
	const { artifact } = end;
	const state = { turns, tainted: tainted === true };
	const kept = keepMessages(team, task, end.messages ?? messages, state);
	const r = applyTask(
		artifact ? withArtifact(kept, task, artifact) : kept,
		task,
		event,
	);
	if (!r.change) return stuck(s, l);
	if (!apply(s, l, { type: "TEAM", team: r.team })) return false;
	if (artifact) announce(s, l, team, { task, artifact });
	changed(s, l, team.tasks[task]?.id, r.change);
	return true;
};

// Submits a report that passed its checks, kept as the task's artifact.
export const land = async (
	s: EngineState,
	l: Live,
	sent: { readonly report: string; readonly messages?: readonly ChatMessage[] },
) => {
	const token = l.token;
	if (!refreshVerificationSnapshot(s, l) || l.token !== token) return;
	const { team, task } = l.snapshot.context;
	if (
		!team ||
		!task ||
		team.tasks[task]?.status !== "in_progress" ||
		l.snapshot.value !== "running" ||
		!eligibleVerification(team, task, sent.report)
	)
		return;
	const evaluationId = team.tasks[task]?.verification?.evaluationId;
	const agentId = team.tasks[task]?.context.agentId;
	const json = guardrailOf(team, task) !== undefined;
	const artifact = await saveArtifact(s, l, { report: sent.report, json });
	if (artifact === false) return; // the write failed the run
	refreshVerificationSnapshot(s, l);
	const current = l.snapshot.context.team;
	if (
		!current ||
		l.snapshot.value !== "running" ||
		l.token !== token ||
		l.snapshot.context.task !== task ||
		current.tasks[task]?.status !== "in_progress" ||
		current.tasks[task]?.context.agentId !== agentId ||
		current.tasks[task]?.verification?.evaluationId !== evaluationId ||
		!eligibleVerification(current, task, sent.report)
	)
		return;
	const end = {
		artifact,
		...(sent.messages ? { messages: sent.messages } : {}),
	};
	endAttempt(s, l, { type: "SUBMIT", report: sent.report }, end);
};
