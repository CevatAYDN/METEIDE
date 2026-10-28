import type { ChatMessage } from "@mete/contracts";
import type { Platform } from "./prompt.js";
import { type TeamState, withClarify } from "./team.js";
import { firstSentence, nameOf, taskConversation } from "./team-run.js";

// The questions before the work (docs/08, step 1; ADR-142): a task with `before_start.clarify_with`
// first asks its questions with no tools; the role it names answers them in a conversation of its
// own, or the human answers as for a blocked task, and the task works with the answers. Pure.

const taskOf = (team: TeamState, id: string) =>
	team.template.tasks.find((t) => t.id === id);

/** The role id or "human" a task asks before it works, if it asks. */
export const clarifierOf = (team: TeamState, id: string) =>
	taskOf(team, id)?.before_start?.clarify_with;

/** Whether a reply to the ask holds no questions, so the task goes on at once. */
export const noQuestions = (reply: string) =>
	/^(none|no questions)?[.!]?$/i.test(reply.trim());

/** What the task's agent hears when it has no questions. */
export const GO_ON = "Go on with the task.";

const askLine = (team: TeamState, by: string) =>
	[
		`Before you start, write the questions whose answers you need to do this task well, one per line; ${nameOf(team, by)} answers them.`,
		"Ask only what the goal, the reports and the workspace above do not tell you. If you need nothing, reply with the single word none.",
	].join(" ");

type RunText = {
	readonly goal: string;
	readonly brief?: string | undefined;
	readonly workspace?: string | undefined;
};

/**
 * A task's conversation as it opens or goes on, and the team with its questions moved on: a fresh
 * task that clarifies opens with the ask, and the human's answer to asked questions is worded so.
 */
export const openTask = (
	team: TeamState,
	id: string,
	run: RunText,
	where: Platform,
): { team: TeamState; messages: ChatMessage[] } => {
	const entry = team.tasks[id];
	const by = clarifierOf(team, id);
	if (by && entry && entry.messages.length === 0 && !entry.context.clarify) {
		const ask = { role: "user" as const, content: askLine(team, by) };
		const opening = taskConversation(team, id, run, where);
		return {
			team: withClarify(team, id, "asking"),
			messages: [...opening, ask],
		};
	}
	const answer = entry?.context.feedback;
	if (entry?.context.clarify === "asked" && answer) {
		const said = `The human answers your questions: ${answer}`;
		const messages = [
			...entry.messages,
			{ role: "user" as const, content: said },
		];
		return { team: withClarify(team, id, undefined), messages };
	}
	return { team, messages: taskConversation(team, id, run, where) };
};

/** The opening of the conversation in which role `by` answers a task's questions. */
export const answerConversation = (
	team: TeamState,
	id: string,
	ask: {
		readonly by: string;
		readonly question: string;
		readonly goal: string;
	},
	where: Platform,
): ChatMessage[] => {
	const role = team.template.roles.find((r) => r.id === ask.by);
	const asker = nameOf(team, taskOf(team, id)?.role ?? "");
	const system = [
		`You are ${role?.name ?? ask.by}, one member of a team.`,
		`Your goal: ${role?.goal ?? "answer questions"}.`,
		...(role?.backstory ? [role.backstory] : []),
		`${asker} asks you questions before starting its task. Answer each one from evidence: read the files or search the sources you need and name where each answer comes from; say plainly what you could not find, and do not guess.`,
		"Keep the answers short and spend tokens with care. Reply without calling a tool: that reply is your answer.",
		`Operating system: ${where.os}. Shell: ${where.shell}.`,
	].join("\n");
	const user = [
		`Team goal: ${ask.goal}`,
		`${asker}'s task: ${taskOf(team, id)?.title ?? id}`,
		`Questions from ${asker}:\n${ask.question}`,
	].join("\n\n");
	return [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
};

/** The answer as the task's agent hears it. */
export const answerLine = (team: TeamState, by: string, answer: string) =>
	`Answers from ${nameOf(team, by)}: ${answer}`;

/** A message's summary: its first sentence, cut to 80 characters with no model call (docs/07). */
export const summaryOf = (text: string) => firstSentence(text).slice(0, 80);
