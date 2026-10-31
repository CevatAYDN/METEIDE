import { describe, expect, it } from "vitest";
import type { AgentCard } from "../../src/domain/agents.js";
import { sceneOf } from "../../src/domain/scene.js";
import { NO_SIGNALS, type RunSignals } from "../../src/domain/signals.js";
import type { TaskCard, TeamView } from "../../src/domain/team-view.js";

// The studio room from team views written by hand.

const agent = (
	id: string,
	roleId: string,
	more: Partial<AgentCard> = {},
): AgentCard => ({
	id,
	roleId,
	providerId: "groq",
	modelId: "m",
	thinking: false,
	...more,
});
const task = (title: string, status: TaskCard["status"]): TaskCard => ({
	id: title,
	title,
	roleId: "dev",
	dependsOn: [],
	status,
});
const view = (
	agents: AgentCard[],
	signals: Partial<RunSignals> = {},
	tasks: TaskCard[] = [],
): TeamView => ({
	seen: new Set(),
	tasks,
	agents,
	signals: { ...NO_SIGNALS, ...signals },
	checkpoints: [],
});

describe("the studio room", () => {
	it("seats the lead roles in the top row and the rest below, six desks a row", () => {
		const devs = Array.from({ length: 7 }, (_, i) => agent(`d${i}`, "dev"));
		const s = sceneOf(
			view([agent("l", "lead"), ...devs], { leadRoles: ["lead"] }),
		);
		expect(s.rows.map((r) => r.map((c) => c.id))).toEqual([
			["l"],
			["d0", "d1", "d2", "d3", "d4", "d5"],
			["d6"],
		]);
	});

	it("shows what each agent does: waiting on quota, then a tool, then thinking", () => {
		const resetsAt = "2026-10-24T00:00:00.000Z";
		const agents = [
			agent("w", "dev", { providerId: "groq", tool: "fs.read@1" }),
			agent("t", "dev", { providerId: "nvidia", tool: "fs.read@1" }),
			agent("k", "dev", { providerId: "nvidia", thinking: true }),
			agent("i", "dev", { providerId: "nvidia" }),
		];
		const paused = sceneOf(
			view(agents, { pausedFor: "quota", exhausted: { groq: resetsAt } }),
		);
		expect(paused.rows[0]).toEqual([
			{ id: "w", roleId: "dev", count: 1, state: "waiting", resetsAt },
			{ id: "t", roleId: "dev", count: 1, state: "working", tool: "fs.read@1" },
			{ id: "k", roleId: "dev", count: 1, state: "thinking" },
			{ id: "i", roleId: "dev", count: 1, state: "idle" },
		]);
		// A spent quota alone does not send anyone to the coffee corner: the run must be paused for it.
		const running = sceneOf(view(agents, { exhausted: { groq: resetsAt } }));
		expect(running.rows[0]?.[0]?.state).toBe("working");
	});

	it("is offline while the run is paused for the network, and only then", () => {
		expect(sceneOf(view([], { pausedFor: "network" })).offline).toBe(true);
		expect(sceneOf(view([], { pausedFor: "quota" })).offline).toBeFalsy();
		expect(sceneOf(view([])).offline).toBeFalsy();
	});

	it("stands one character per role for more than twelve agents, with the count", () => {
		const many = [
			...Array.from({ length: 10 }, (_, i) => agent(`d${i}`, "dev")),
			...Array.from({ length: 3 }, (_, i) => agent(`a${i}`, "artist")),
		];
		const s = sceneOf(view(many));
		expect(s.rows).toEqual([
			[
				{ id: "dev", roleId: "dev", count: 10, state: "idle" },
				{ id: "artist", roleId: "artist", count: 3, state: "idle" },
			],
		]);
	});

	it("gives an agent its attempt of a best-of-N task, but not a role's group (ADR-162)", () => {
		const attempt = { k: 2, n: 2 };
		const two = sceneOf(
			view([agent("a", "dev"), agent("b", "dev", { attempt })]),
		);
		expect(two.rows[0]).toEqual([
			{ id: "a", roleId: "dev", count: 1, state: "idle" },
			{ id: "b", roleId: "dev", count: 1, state: "idle", attempt },
		]);
		const many = Array.from({ length: 13 }, (_, i) =>
			agent(`d${i}`, "dev", { attempt }),
		);
		expect(sceneOf(view(many)).rows[0]?.[0]).not.toHaveProperty("attempt");
	});

	it("puts the task notes on the board by column", () => {
		const s = sceneOf(
			view([], {}, [
				task("a", "todo"),
				task("b", "submitted"),
				task("c", "approved"),
				task("d", "blocked"),
			]),
		);
		const titles = (n: readonly { title: string }[]) => n.map((x) => x.title);
		expect(titles(s.notes.todo)).toEqual(["a"]);
		expect(titles(s.notes.in_progress)).toEqual(["b", "d"]);
		expect(s.notes.done).toEqual([{ id: "c", title: "c" }]);
		expect(s.notes.in_progress.map((n) => n.blocked)).toEqual([
			undefined,
			true,
		]);
		expect(s.rows).toEqual([]);
	});
});
