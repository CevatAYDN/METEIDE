import { NO_SIGNALS, type TaskCard, type TeamView } from "@mete/ui-studio";
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
const view = (tasks: TaskCard[]): TeamView => ({
	seen: new Set(),
	tasks,
	agents: [],
	signals: NO_SIGNALS,
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
});
