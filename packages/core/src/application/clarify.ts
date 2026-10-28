import {
	answerConversation,
	answerLine,
	clarifierOf,
	noQuestions,
	summaryOf,
} from "../domain/clarify.js";
import {
	applyTask,
	GO_ON,
	keepMessages,
	type TeamState,
	withClarify,
} from "../domain/team.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	platform,
	stuck,
} from "./run-state.js";

// The questions before the work (docs/08, step 1; ADR-142): what the asking task's reply and the
// answering role's reply do to the run.

// The asking task, its entry and who answers it; undefined only through a bug.
const askingTask = (l: Live) => {
	const { team, task } = l.snapshot.context;
	const entry = team && task ? team.tasks[task] : undefined;
	const by = team && task ? clarifierOf(team, task) : undefined;
	return team && task && entry && by ? { team, task, entry, by } : undefined;
};

// The human answers as for a blocked task (docs/07, Task state machine).
const blockForHuman = (
	s: EngineState,
	l: Live,
	team: TeamState,
	task: string,
) => {
	const r = applyTask(team, task, { type: "BLOCK", reason: "clarification" });
	apply(s, l, { type: "TEAM", team: r.team });
	if (r.change)
		emit(
			s,
			l,
			{ type: "task.status.changed", payload: r.change },
			team.tasks[task]?.id,
		);
};

/**
 * Takes the task agent's reply to the ask: none goes on with the task; questions go to the role the
 * task names, in a conversation of its own, or block the task until the human answers.
 */
export const asked = (s: EngineState, l: Live, reply: string) => {
	const at = askingTask(l);
	if (!at) return stuck(s, l);
	const { team, task, entry, by } = at;
	const question = reply.trim();
	if (noQuestions(question))
		return apply(s, l, {
			type: "REPAIR",
			team: withClarify(team, task, undefined),
			content: GO_ON,
		});
	const body = { toRoleId: by, question };
	emit(s, l, { type: "task.clarification.requested", payload: body }, entry.id);
	const { messages, goal } = l.snapshot.context;
	const kept = withClarify(keepMessages(team, task, messages), task, "asked");
	if (by === "human") return blockForHuman(s, l, kept, task);
	const where = platform(s, l);
	if (!where) return;
	const opening = answerConversation(team, task, { by, question, goal }, where);
	apply(s, l, {
		type: "SWITCH",
		task,
		team: kept,
		messages: opening,
		clarify: by,
	});
};

/** Takes the answering role's reply: the task's agent goes on in its own conversation with it. */
export const answered = (s: EngineState, l: Live, reply: string) => {
	const { team, task, clarify: by, agent } = l.snapshot.context;
	const entry = team && task ? team.tasks[task] : undefined;
	if (!team || !task || !entry || !by) return stuck(s, l);
	const answer = reply.trim() || "(no answer)";
	const message = {
		messageId: s.deps.newId(),
		from: agent?.id ?? by,
		to: entry.context.agentId ?? entry.id,
		kind: "answer",
		summary: summaryOf(answer),
	} as const;
	emit(s, l, { type: "agent.message.sent", payload: message }, entry.id);
	const heard = {
		role: "user" as const,
		content: answerLine(team, by, answer),
	};
	apply(s, l, {
		type: "SWITCH",
		task,
		team: withClarify(team, task, undefined),
		messages: [...entry.messages, heard],
	});
};
