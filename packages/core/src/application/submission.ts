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
import { announce, saveArtifact } from "./artifacts.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	stuck,
} from "./run-state.js";

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
	const { team, task, messages } = l.snapshot.context;
	if (!team || !task) return stuck(s, l);
	const { artifact } = end;
	const kept = keepMessages(team, task, end.messages ?? messages);
	const r = applyTask(
		artifact ? withArtifact(kept, task, artifact) : kept,
		task,
		event,
	);
	if (!r.change) return stuck(s, l);
	apply(s, l, { type: "TEAM", team: r.team });
	if (artifact) announce(s, l, team, { task, artifact });
	changed(s, l, team.tasks[task]?.id, r.change);
};

// Submits a report that passed its checks, kept as the task's artifact.
export const land = async (
	s: EngineState,
	l: Live,
	sent: { readonly report: string; readonly messages?: readonly ChatMessage[] },
) => {
	const { team, task } = l.snapshot.context;
	const json = team && task ? guardrailOf(team, task) !== undefined : false;
	const artifact = await saveArtifact(s, l, { report: sent.report, json });
	if (artifact === false) return; // the write failed the run
	const end = {
		artifact,
		...(sent.messages ? { messages: sent.messages } : {}),
	};
	endAttempt(s, l, { type: "SUBMIT", report: sent.report }, end);
};
