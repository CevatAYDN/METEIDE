import type { MeteEvent } from "@mete/contracts";

// The agents of a run as the Team panel's views draw them (ADR-051, docs/13): the core puts the
// active agent's id on the envelope of every event it publishes, and agent.created comes at the
// agent's first model call, with the task it works on. The coffee-corner wait comes from the run's
// signals (ADR-052). shortcut: quota.consumed names no agent, so docs/13's request count waits for
// an event that does.

/** One agent as the views show it. */
export type AgentCard = {
	readonly id: string;
	readonly roleId: string;
	readonly providerId: string;
	readonly modelId: string;
	/** The task the agent was created for; none for a single-agent run. */
	readonly taskId?: string;
	readonly thinking: boolean;
	/** The capability of the tool call the agent waits on. */
	readonly tool?: string;
};

const change = (
	agents: readonly AgentCard[],
	id: string | undefined,
	update: (a: AgentCard) => AgentCard,
) => agents.map((a) => (a.id === id ? update(a) : a));

const created = (
	agents: readonly AgentCard[],
	e: Extract<MeteEvent, { type: "agent.created" }>,
): readonly AgentCard[] => {
	if (!e.agentId || agents.some((a) => a.id === e.agentId)) return agents;
	return [
		...agents,
		{
			id: e.agentId,
			roleId: e.payload.roleId,
			providerId: e.payload.providerId,
			modelId: e.payload.modelId,
			...(e.taskId ? { taskId: e.taskId } : {}),
			// The core creates the agent at its first model reply, inside the turn whose
			// agent.thinking.started carried no agent id yet: the agent is thinking.
			thinking: true,
		},
	];
};

/** The agents after one event of their run. */
export const agentsAfter = (
	agents: readonly AgentCard[],
	e: MeteEvent,
): readonly AgentCard[] => {
	if (e.type === "agent.created") return created(agents, e);
	if (e.type === "agent.model.changed")
		return change(agents, e.agentId, (a) => ({ ...a, ...e.payload.to }));
	if (e.type === "agent.thinking.started" || e.type === "agent.thinking.ended")
		return change(agents, e.agentId, (a) => ({
			...a,
			thinking: e.type === "agent.thinking.started",
		}));
	if (e.type === "agent.tool.called")
		return change(agents, e.agentId, (a) => ({
			...a,
			tool: e.payload.capability,
		}));
	if (e.type === "agent.tool.completed")
		return change(agents, e.agentId, ({ tool: _, ...a }) => a);
	return agents;
};
