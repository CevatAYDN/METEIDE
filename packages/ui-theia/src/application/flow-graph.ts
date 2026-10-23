import {
	type AgentCard,
	type Place,
	placeOf,
	type TaskCard,
	type TeamView,
} from "@mete/ui-studio";

// The Flow view's graph (docs/13, Team panel; ADR-051): the run's tasks as nodes and dependsOn as
// edges, laid out in levels: a task sits one level after the deepest task it waits for, and the
// tasks of a level stack in their order. Agents stand in a column before the tasks, each with an
// edge to the task it works on. React Flow does no layout, and a layout library is not in docs/05,
// so this is small own code.

const LEVEL_WIDTH = 260;
const ROW_HEIGHT = 110;

/** What a node shows: a task with its role and where the Board would place it, or an agent. */
export type FlowNodeData =
	| ({
			readonly kind: "task";
			readonly title: string;
			readonly roleId: string;
	  } & Place)
	| {
			readonly kind: "agent";
			readonly roleId: string;
			readonly modelId: string;
			readonly thinking: boolean;
	  };

/** A node in React Flow's shape. */
export type FlowNode = {
	readonly id: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly data: FlowNodeData;
};

/** An edge from a task to the one that waits for it, or from an agent to its task. */
export type FlowEdge = {
	readonly id: string;
	readonly source: string;
	readonly target: string;
};

// The level of each task; a cycle (never sent by the core) ends at the task met twice.
const levelsOf = (tasks: readonly TaskCard[]) => {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	const levels = new Map<string, number>();
	const levelOf = (id: string, path: Set<string>): number => {
		const known = levels.get(id);
		if (known !== undefined) return known;
		if (path.has(id)) return 0;
		path.add(id);
		const deps = (byId.get(id)?.dependsOn ?? []).filter((d) => byId.has(d));
		const level = Math.max(-1, ...deps.map((d) => levelOf(d, path))) + 1;
		path.delete(id);
		levels.set(id, level);
		return level;
	};
	for (const t of tasks) levelOf(t.id, new Set());
	return levels;
};

// Agent ids get a prefix, so an agent never takes the node of a task with the same id.
const agentNodes = (agents: readonly AgentCard[], ids: Set<string>) => ({
	nodes: agents.map(
		(a, row): FlowNode => ({
			id: `agent:${a.id}`,
			position: { x: -LEVEL_WIDTH, y: row * ROW_HEIGHT },
			data: {
				kind: "agent",
				roleId: a.roleId,
				modelId: a.modelId,
				thinking: a.thinking,
			},
		}),
	),
	edges: agents.flatMap((a): FlowEdge[] =>
		a.taskId !== undefined && ids.has(a.taskId)
			? [
					{
						id: `agent:${a.id}>${a.taskId}`,
						source: `agent:${a.id}`,
						target: a.taskId,
					},
				]
			: [],
	),
});

/** The nodes and edges of the run's tasks and agents. */
export const flowGraph = (
	view: TeamView,
): { readonly nodes: FlowNode[]; readonly edges: FlowEdge[] } => {
	const levels = levelsOf(view.tasks);
	const rows = new Map<number, number>();
	const nodes = view.tasks.map((t): FlowNode => {
		const level = levels.get(t.id) ?? 0;
		const row = rows.get(level) ?? 0;
		rows.set(level, row + 1);
		return {
			id: t.id,
			position: { x: level * LEVEL_WIDTH, y: row * ROW_HEIGHT },
			data: {
				kind: "task",
				title: t.title,
				roleId: t.roleId,
				...placeOf(t.status),
			},
		};
	});
	const ids = new Set(view.tasks.map((t) => t.id));
	const edges = view.tasks.flatMap((t) =>
		t.dependsOn
			.filter((d) => ids.has(d))
			.map((d) => ({ id: `${d}>${t.id}`, source: d, target: t.id })),
	);
	const agents = agentNodes(view.agents, ids);
	return {
		nodes: [...nodes, ...agents.nodes],
		edges: [...edges, ...agents.edges],
	};
};
