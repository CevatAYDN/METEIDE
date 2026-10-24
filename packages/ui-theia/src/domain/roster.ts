import type { AgentCard, TaskCard, TeamView } from "@mete/ui-studio";

// The Team view's rows (ADR-089): one per role of the run, from the fold the Board and the Studio
// share. A role's state is the first that holds: waiting for the user, for quota, working on a tool
// call, thinking, blocked, done, idle.

/** What a member is doing, as the row says it. */
export type MemberState =
	| { readonly kind: "waits_for_you" }
	| { readonly kind: "quota"; readonly resetsAt: string }
	| { readonly kind: "working"; readonly tool: string }
	| { readonly kind: "thinking" }
	| { readonly kind: "blocked" }
	| { readonly kind: "done" }
	| { readonly kind: "idle" };

/** One row: a role, its latest agent, its state, its task now and its task count. */
export type Member = {
	readonly roleId: string;
	readonly agent?: AgentCard;
	readonly state: MemberState;
	/** The task it works on, or its next one and the task that one still waits for. */
	readonly now?: { readonly task: string; readonly waitsFor?: string };
	readonly done: number;
	readonly total: number;
	/** The tokens and calls of every agent the role has had (ADR-090); none before a call with usage. */
	readonly used?: { readonly tokens: number; readonly calls: number };
};

/** A role id written as words: `frontend_developer` as "Frontend developer". */
export const roleWords = (roleId: string) => {
	const words = roleId.replace(/[_-]+/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
};

const rolesOf = (view: TeamView) => [
	...new Set([
		...view.tasks.map((t) => t.roleId),
		...view.agents.map((a) => a.roleId),
	]),
];

// The agent doing something, or else the role's latest.
const agentOf = (agents: readonly AgentCard[]) =>
	agents.find((a) => a.tool || a.thinking) ?? agents.at(-1);

const nowOf = (
	view: TeamView,
	tasks: readonly TaskCard[],
	agent: AgentCard | undefined,
): Member["now"] => {
	const open = tasks.filter((t) => t.status !== "approved");
	const task = open.find((t) => t.id === agent?.taskId) ?? open[0];
	if (!task) return undefined;
	const waits = view.tasks.find(
		(t) => task.dependsOn.includes(t.id) && t.status !== "approved",
	);
	return waits
		? { task: task.title, waitsFor: waits.title }
		: { task: task.title };
};

const stateOf = (
	view: TeamView,
	tasks: readonly TaskCard[],
	agent: AgentCard | undefined,
): MemberState => {
	const { pausedFor, exhausted } = view.signals;
	// A task whose approval the human was asked for, while the run is paused for it (ADR-091).
	if (pausedFor === "approval" && tasks.some((t) => t.waitsForHuman))
		return { kind: "waits_for_you" };
	const resetsAt = agent && exhausted[agent.providerId];
	if (pausedFor === "quota" && resetsAt) return { kind: "quota", resetsAt };
	if (agent?.tool) return { kind: "working", tool: agent.tool };
	if (agent?.thinking) return { kind: "thinking" };
	if (tasks.some((t) => t.status === "blocked")) return { kind: "blocked" };
	if (tasks.length > 0 && tasks.every((t) => t.status === "approved"))
		return { kind: "done" };
	return { kind: "idle" };
};

const usedOf = (agents: readonly AgentCard[]): Member["used"] => {
	const counted = agents.flatMap((a) => (a.usage ? [a.usage] : []));
	if (counted.length === 0) return undefined;
	return {
		tokens: counted.reduce((n, u) => n + u.tokens, 0),
		calls: counted.reduce((n, u) => n + u.calls, 0),
	};
};

const memberOf = (view: TeamView, roleId: string): Member => {
	const tasks = view.tasks.filter((t) => t.roleId === roleId);
	const agents = view.agents.filter((a) => a.roleId === roleId);
	const agent = agentOf(agents);
	const used = usedOf(agents);
	const now = nowOf(view, tasks, agent);
	return {
		roleId,
		...(agent ? { agent } : {}),
		state: stateOf(view, tasks, agent),
		...(now ? { now } : {}),
		done: tasks.filter((t) => t.status === "approved").length,
		total: tasks.length,
		...(used ? { used } : {}),
	};
};

/** The rows of the Team view, in the order the run first names each role. */
export const rosterOf = (view: TeamView): readonly Member[] =>
	rolesOf(view).map((roleId) => memberOf(view, roleId));
