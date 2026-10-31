import type { MeteEvent, Tier } from "@mete/contracts";

// The agents of a run as the Team panel's views draw them (ADR-051, docs/13): the core puts the
// active agent's id on the envelope of every event it publishes, and agent.created comes at the
// agent's first model call, with the task it works on. The coffee-corner wait comes from the run's
// signals (ADR-052). Each model call's token counts close it on agent.thinking.ended (ADR-090).
// shortcut: the Studio card does not show docs/13's request count yet; `usage.calls` holds it.

/** One agent as the views show it. */
export type AgentCard = {
	readonly id: string;
	readonly roleId: string;
	readonly providerId: string;
	readonly modelId: string;
	/** Its role's tier, when agent.created carries it (ADR-077). */
	readonly tier?: Tier;
	/** The attempt of a best-of-N task it works (ADR-162). */
	readonly attempt?: { readonly k: number; readonly n: number };
	/** The task the agent was created for; none for a single-agent run. */
	readonly taskId?: string;
	readonly thinking: boolean;
	/** The capability of the tool call the agent waits on. */
	readonly tool?: string;
	/** The last progress step that call reported (ADR-067). */
	readonly progress?: { readonly progress: number; readonly total?: number };
	/** Its model calls with token counts (ADR-090); none before the first, or in an older run. */
	readonly usage?: Usage;
};

/** The token counts of an agent's calls, and its latest call's prompt with the model it used. */
export type Usage = {
	readonly calls: number;
	/** Prompt and completion tokens of every call added up. */
	readonly tokens: number;
	readonly last: {
		readonly prompt: number;
		readonly providerId: string;
		readonly modelId: string;
	};
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
			...(e.payload.tier ? { tier: e.payload.tier } : {}),
			...(e.payload.attempt ? { attempt: e.payload.attempt } : {}),
			...(e.taskId ? { taskId: e.taskId } : {}),
			// The core creates the agent at its first model reply, inside the turn whose
			// agent.thinking.started carried no agent id yet: the agent is thinking.
			thinking: true,
		},
	];
};

// The call that ended used the agent's current model: agent.model.changed comes before its end.
const ended = (
	a: AgentCard,
	e: Extract<MeteEvent, { type: "agent.thinking.ended" }>,
): AgentCard => {
	const u = e.payload.usage;
	if (!u) return { ...a, thinking: false };
	const usage: Usage = {
		calls: (a.usage?.calls ?? 0) + 1,
		tokens: (a.usage?.tokens ?? 0) + u.prompt + u.completion,
		last: { prompt: u.prompt, providerId: a.providerId, modelId: a.modelId },
	};
	return { ...a, thinking: false, usage };
};

/** The agents after one event of their run. */
export const agentsAfter = (
	agents: readonly AgentCard[],
	e: MeteEvent,
): readonly AgentCard[] => {
	if (e.type === "agent.created") return created(agents, e);
	if (e.type === "agent.model.changed")
		return change(agents, e.agentId, (a) => ({ ...a, ...e.payload.to }));
	if (e.type === "agent.thinking.started")
		return change(agents, e.agentId, (a) => ({ ...a, thinking: true }));
	if (e.type === "agent.thinking.ended")
		return change(agents, e.agentId, (a) => ended(a, e));
	if (e.type === "agent.tool.called")
		return change(agents, e.agentId, (a) => ({
			...a,
			tool: e.payload.capability,
		}));
	if (e.type === "agent.tool.progress")
		return change(agents, e.agentId, (a) => ({
			...a,
			progress: {
				progress: e.payload.progress,
				...(e.payload.total === undefined ? {} : { total: e.payload.total }),
			},
		}));
	if (e.type === "agent.tool.completed")
		return change(agents, e.agentId, ({ tool: _, progress: __, ...a }) => a);
	return agents;
};
