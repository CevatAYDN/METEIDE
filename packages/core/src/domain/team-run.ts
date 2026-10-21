import type { ChatMessage } from "@mete/contracts";
import type { Platform } from "./prompt.js";
import type { RunContext } from "./run-machine.js";
import type { TeamState } from "./team.js";
import { type Seat, SINGLE_AGENT } from "./tools.js";

// What a team task's agent receives (docs/08, Agent context assembly): its role, the goal, the
// task and the reports of its context tasks. Pure.
// shortcut: no acceptance criteria, knowledge results, skills or start brief yet; they come with
// the artifacts, knowledge (Phase 4) and handoff slices.

const taskOf = (team: TeamState, id: string) =>
	team.template.tasks.find((t) => t.id === id);

const roleOf = (team: TeamState, id: string) =>
	team.template.roles.find((r) => r.id === taskOf(team, id)?.role);

/** The seat of a task's agent: its role's tier, needs and capabilities. */
export const seatOf = (team: TeamState, id: string): Seat => {
	const role = roleOf(team, id);
	return {
		tier: role?.tier ?? "coder",
		needs: [...(role?.needs ?? [])],
		capabilities: role?.capabilities ?? [],
	};
};

/** The seat of the run's active agent: its task's role, or the single agent. */
export const activeSeat = (c: RunContext): Seat =>
	c.team && c.task ? seatOf(c.team, c.task) : SINGLE_AGENT;

/** The role, agent id and Task id the active task gives its agent; a single agent is role assistant. */
export const activeRole = (c: RunContext) => {
	const entry = c.team && c.task ? c.team.tasks[c.task] : undefined;
	const roleId = c.team && c.task ? taskOf(c.team, c.task)?.role : undefined;
	return {
		roleId: roleId ?? "assistant",
		agentId: entry?.context.agentId,
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
		`Operating system: ${where.os}. Shell: ${where.shell}.`,
	].join("\n");
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
	goal: string,
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
		`Team goal: ${goal}`,
		`Your task: ${taskOf(team, id)?.title ?? id}`,
		...reports(team, id),
	].join("\n\n");
	return [
		{ role: "system", content: system(team, id, where) },
		{ role: "user", content: user },
	];
};
