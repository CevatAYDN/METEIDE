import {
	type AgentCard,
	NO_SIGNALS,
	type TaskCard,
	type TeamView,
} from "@mete/ui-studio";
import { describe, expect, it } from "vitest";
import { flowGraph } from "../src/application/flow-graph.js";

// The Flow view's graph from a team view, without React Flow.

const card = (
	id: string,
	dependsOn: string[],
	status: TaskCard["status"] = "todo",
): TaskCard => ({
	id,
	title: `task ${id}`,
	roleId: "writer",
	dependsOn,
	status,
});
const view = (tasks: TaskCard[], agents: AgentCard[] = []): TeamView => ({
	seen: new Set(),
	tasks,
	agents,
	signals: NO_SIGNALS,
	checkpoints: [],
});

describe("the Flow graph", () => {
	it("puts each task one level after the tasks it waits for, with an edge from each", () => {
		const g = flowGraph(
			view([
				card("brief", [], "approved"),
				card("build", ["brief"], "submitted"),
				card("art", ["brief"]),
				card("qa", ["build", "art"]),
			]),
		);
		const level = Object.fromEntries(g.nodes.map((n) => [n.id, n.position.x]));
		expect(level.brief).toBeLessThan(level.build ?? 0);
		expect(level.build).toBe(level.art);
		expect(level.art).toBeLessThan(level.qa ?? 0);
		const sameLevel = g.nodes.filter((n) => n.position.x === level.build);
		expect(new Set(sameLevel.map((n) => n.position.y)).size).toBe(2);
		expect(g.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
			"brief>build",
			"brief>art",
			"build>qa",
			"art>qa",
		]);
		expect(g.nodes.find((n) => n.id === "build")?.data).toEqual({
			kind: "task",
			title: "task build",
			roleId: "writer",
			column: "in_progress",
			marker: "in_review",
		});
	});

	it("drops an edge from a task it does not know and survives a cycle", () => {
		const g = flowGraph(view([card("a", ["ghost", "b"]), card("b", ["a"])]));
		expect(g.nodes).toHaveLength(2);
		expect(g.edges.map((e) => e.source).sort()).toEqual(["a", "b"]);
		expect(flowGraph(view([]))).toEqual({ nodes: [], edges: [] });
	});

	it("puts each agent under the task it works on, with an edge to it", () => {
		const agent = (id: string, taskId?: string): AgentCard => ({
			id,
			roleId: "artist",
			providerId: "groq",
			modelId: "m1",
			thinking: id === "a1",
			...(taskId ? { taskId } : {}),
			...(id === "a1" ? { progress: { progress: 3, total: 4 } } : {}),
		});
		const g = flowGraph(
			view(
				[card("brief", []), card("art", ["brief"])],
				[agent("a1", "art"), agent("a2", "ghost"), agent("a3")],
			),
		);
		const agents = g.nodes.filter((n) => n.data.kind === "agent");
		expect(agents.map((n) => n.id)).toEqual([
			"agent:a1",
			"agent:a2",
			"agent:a3",
		]);
		const at = (id: string) => g.nodes.find((n) => n.id === id)?.position;
		// a1 stands under its task; a2 (an unknown task) and a3 (none) stand under level 0.
		expect(at("agent:a1")?.x).toBe(at("art")?.x);
		expect(at("agent:a1")?.y).toBeGreaterThan(at("art")?.y ?? 0);
		expect(at("agent:a2")?.x).toBe(at("brief")?.x);
		expect(at("agent:a3")?.x).toBe(at("brief")?.x);
		const ys = [at("brief")?.y, at("agent:a2")?.y, at("agent:a3")?.y];
		expect(new Set(ys).size).toBe(3);
		expect(agents[0]?.data).toEqual({
			kind: "agent",
			roleId: "artist",
			modelId: "m1",
			thinking: true,
			progress: "3/4",
		});
		expect(agents[1]?.data).not.toHaveProperty("progress");
		expect(g.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
			"brief>art",
			"agent:a1>art",
		]);
	});
});
