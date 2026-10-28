import type { ChatMessage } from "@mete/contracts";
import type { Platform } from "./prompt.js";
import type { RunContext } from "./run-machine.js";
import { acceptanceOf, spawnGuardrail } from "./spawn.js";
import type { TeamState } from "./team.js";
import { type Seat, SINGLE_AGENT, writes } from "./tools.js";

// What a team task's agent receives (docs/08, Agent context assembly): its role, the goal, the
// task and the reports of its context tasks. Pure.
// A spawned task also gets its acceptance sentences (ADR-057).
// shortcut: no knowledge results or skills yet; they come with the knowledge layer (Phase 6).

const taskOf = (team: TeamState, id: string) =>
	team.template.tasks.find((t) => t.id === id);

const roleOf = (team: TeamState, id: string) =>
	team.template.roles.find((r) => r.id === taskOf(team, id)?.role);

/** A task's guardrail, if it has one. */
export const guardrailOf = (team: TeamState, id: string) =>
	taskOf(team, id)?.guardrail ?? spawnGuardrail(team, id);

/** Whether the task's role has a tool that changes the working tree (docs/08, Parallel work and merging). */
export const isWriter = (team: TeamState, id: string) =>
	writes(roleOf(team, id)?.capabilities ?? []);

/** A task's title, which names its merge commit. */
export const titleOf = (team: TeamState, id: string) =>
	taskOf(team, id)?.title ?? id;

/** A task's verify gates, in template order. */
export const verifyOf = (team: TeamState, id: string) =>
	taskOf(team, id)?.verify ?? [];

/** The seat of a role's agent: its tier, needs and capabilities. */
const roleSeat = (team: TeamState, roleId: string | undefined): Seat => {
	const role = team.template.roles.find((r) => r.id === roleId);
	return {
		tier: role?.tier ?? "coder",
		needs: [...(role?.needs ?? [])],
		capabilities: role?.capabilities ?? [],
	};
};

/** Whether the active task's agent is asking its questions before the work (ADR-142). */
export const isAsking = (c: RunContext) =>
	!c.review &&
	!c.clarify &&
	c.team !== undefined &&
	c.task !== undefined &&
	c.team.tasks[c.task]?.context.clarify === "asking";

/** The seat of the run's active agent: its task's role, a reviewer's or an answerer's, or the single agent. */
export const activeSeat = (c: RunContext): Seat => {
	if (!c.team || !c.task) return SINGLE_AGENT;
	const by = c.review ?? c.clarify;
	const seat = roleSeat(c.team, by ?? taskOf(c.team, c.task)?.role);
	// The questions are asked with no tools, so the agent cannot start the work first.
	return isAsking(c) ? { ...seat, capabilities: [] } : seat;
};

/** The seat of a task's agent: its role's tier, needs and capabilities. */
export const seatOf = (team: TeamState, id: string): Seat =>
	roleSeat(team, taskOf(team, id)?.role);

/** The role, agent id and Task id the active task gives its agent; a single agent is role assistant. */
export const activeRole = (c: RunContext) => {
	const entry = c.team && c.task ? c.team.tasks[c.task] : undefined;
	const roleId = c.team && c.task ? taskOf(c.team, c.task)?.role : undefined;
	// A reviewer or an answerer gets an agent of its own; the task's agent id is the worker's.
	const by = c.review ?? c.clarify;
	return {
		roleId: by ?? roleId ?? "assistant",
		agentId: by ? undefined : entry?.context.agentId,
		taskId: entry?.id,
	};
};

const system = (team: TeamState, id: string, where: Platform) => {
	const role = roleOf(team, id);
	return [
		`You are ${role?.name ?? "an agent"}, one member of a team.`,
		`Your goal: ${role?.goal ?? "do the task"}.`,
		...(role?.backstory ? [role.backstory] : []),
		"Do only your task. When it is done, reply without calling a tool: that reply is your report.",
		// Every team, the user's own too, works from evidence and spends tokens with care (ADR-135).
		"Work from evidence: read the files and reports you need and do not guess what you have not read; when something you need is missing, name it in your report as an open question.",
		"Spend tokens with care: read a file only when you need it, not again while its content is in this conversation; write a file once and fix it with small edits.",
		"Your report says what you did, the files you wrote or changed, how you checked each claim, your open questions and what the next member needs to know.",
		`Operating system: ${where.os}. Shell: ${where.shell}.`,
	].join("\n");
};

// The first sentence of a role's goal, at most 200 characters, so the roster stays short.
export const firstSentence = (goal: string) =>
	(/^[\s\S]*?[.!?](?=\s|$)/.exec(goal.trim())?.[0] ?? goal.trim()).slice(
		0,
		200,
	);

export const nameOf = (team: TeamState, roleId: string) =>
	roleId === "human"
		? "The human"
		: (team.template.roles.find((r) => r.id === roleId)?.name ?? roleId);

const gatesText = (gates: ReturnType<typeof verifyOf>) =>
	gates
		.map((g) =>
			"run" in g ? `\`${g.run}\`` : `the capability ${g.capability}`,
		)
		.join(", ");

// Who the task works with (ADR-135): the team, who approves it, who builds on it, what checks it.
const teamLines = (team: TeamState, id: string) => {
	const task = taskOf(team, id);
	const roster = team.template.roles.map(
		(r) =>
			`- ${r.name}${r.id === task?.role ? " (you)" : ""}: ${firstSentence(r.goal)}`,
	);
	const human = team.template.policies.human_checkpoints?.includes(id);
	const approvers = [task?.approval, human ? "human" : undefined].filter(
		(a): a is string => a !== undefined,
	);
	const next = team.template.tasks.filter((t) => t.context?.includes(id));
	const names = [...new Set(next.map((t) => nameOf(team, t.role)))];
	const after = next.flatMap((t) => t.verify ?? []);
	return [
		["Your team:", ...roster].join("\n"),
		...(approvers.length > 0
			? [
					`${[...new Set(approvers)].map((a) => nameOf(team, a)).join(", then ")} approves your work.`,
				]
			: []),
		...(names.length > 0 ? [`Your report goes to: ${names.join(", ")}.`] : []),
		...(task?.verify?.length
			? [`Your work is checked by: ${gatesText(task.verify)}.`]
			: []),
		...(after.length > 0
			? [`Work built on yours is checked by: ${gatesText(after)}.`]
			: []),
	].join("\n");
};

// A spawned task's acceptance sentences (ADR-057); templates give tasks none.
const acceptance = (team: TeamState, id: string) => {
	const lines = acceptanceOf(team, id);
	return lines.length > 0
		? [["Acceptance:", ...lines.map((a) => `- ${a}`)].join("\n")]
		: [];
};

const reports = (team: TeamState, id: string) =>
	(taskOf(team, id)?.context ?? []).map(
		(dep) =>
			`Report of ${taskOf(team, dep)?.title ?? dep}:\n${team.tasks[dep]?.context.report ?? ""}`,
	);

/** A task's conversation: its kept one plus the feedback, or a new opening. */
export const taskConversation = (
	team: TeamState,
	id: string,
	{
		goal,
		brief,
		workspace,
	}: {
		goal: string;
		brief?: string | undefined;
		workspace?: string | undefined;
	},
	where: Platform,
): ChatMessage[] => {
	const entry = team.tasks[id];
	const feedback = entry?.context.feedback;
	if (entry && entry.messages.length > 0)
		return [
			...entry.messages,
			...(feedback
				? [
						{
							role: "user" as const,
							content: `Feedback on your last submission: ${feedback}`,
						},
					]
				: []),
		];
	const user = [
		...(brief ? [brief] : []),
		...(workspace ? [workspace] : []),
		`Team goal: ${goal}`,
		`Your task: ${taskOf(team, id)?.title ?? id}`,
		...acceptance(team, id),
		teamLines(team, id),
		...reports(team, id),
	].join("\n\n");
	return [
		{ role: "system", content: system(team, id, where) },
		{ role: "user", content: user },
	];
};
