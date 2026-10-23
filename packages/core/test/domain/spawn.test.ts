import { parseTemplate, type TeamTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	acceptanceOf,
	spawnGuardrail,
	spawnIssues,
	withSpawned,
} from "../../src/domain/spawn.js";
import {
	applyTask,
	approve,
	nextTeamStep,
	type TeamState,
	TeamStateSchema,
	teamOf,
} from "../../src/domain/team.js";

// spawns (docs/08, ADR-057): an approved task-list@1 becomes tasks of the same run. Pure.

const role = (id: string) => ({
	id,
	name: id,
	goal: `be ${id}`,
	tier: "fast",
	capabilities: [],
});

const studio = (): TeamTemplate => {
	const r = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "studio", name: "Studio", version: "1.0.0" },
		pattern: "hierarchical",
		roles: ["pm", "developer", "tester", "lead"].map(role),
		tasks: [
			{
				id: "plan_tasks",
				role: "pm",
				title: "Split the design into tasks",
				expected_output: "artifact:task-list@1",
				approval: "lead",
				spawns: true,
			},
		],
		spawn_defaults: {
			developer: { approval: "lead", verify: [{ run: "npm test" }] },
		},
	});
	if (!r.ok) throw new Error(r.error.issues.join("; "));
	return r.value;
};

const entry = (id: string, roleId: string, dependsOn?: string[]) => ({
	id,
	role: roleId,
	title: `do ${id}`,
	acceptance: [`${id} works`],
	...(dependsOn ? { dependsOn } : {}),
});

const LIST = JSON.stringify({
	tasks: [entry("canvas", "developer"), entry("check", "tester", ["canvas"])],
});

// The plan task submitted with `report` and approved by the lead.
const approved = (report: string): TeamState => {
	let team = teamOf(studio());
	team = applyTask(team, "plan_tasks", { type: "START", agentId: "a1" }).team;
	team = applyTask(team, "plan_tasks", { type: "SUBMIT", report }).team;
	return approve(team, "plan_tasks", "lead").team;
};

describe("spawned tasks (ADR-057)", () => {
	it("checks a spawns task against task-list@1 as if it had a guardrail", () => {
		const team = teamOf(studio());
		expect(spawnGuardrail(team, "plan_tasks")).toEqual({
			schema: "task-list@1",
			max_retries: 2,
		});
	});

	it("refuses an entry whose role is not in the template or whose id is a template task's", () => {
		const team = teamOf(studio());
		expect(spawnIssues(team, "plan_tasks", LIST)).toBeUndefined();
		const bad = JSON.stringify({
			tasks: [entry("plan_tasks", "developer"), entry("art", "artist")],
		});
		expect(spawnIssues(team, "plan_tasks", bad)).toBe(
			[
				"tasks.0.id: plan_tasks is already a task of the template",
				"tasks.1.role: artist is not a role of the template",
			].join("\n"),
		);
	});

	it("adds each entry once, with its role's spawn_defaults and its dependencies, after approval", () => {
		const team = approved(LIST);
		const r = withSpawned(team, "plan_tasks");
		expect(r.created).toEqual(["canvas", "check"]);
		const tasks = r.team.template.tasks;
		expect(tasks.map((t) => [t.id, t.role, t.context])).toEqual([
			["plan_tasks", "pm", undefined],
			["canvas", "developer", ["plan_tasks"]],
			["check", "tester", ["plan_tasks", "canvas"]],
		]);
		expect(tasks[1]).toMatchObject({
			title: "do canvas",
			approval: "lead",
			verify: [{ run: "npm test" }],
		});
		expect(r.team.tasks.canvas?.status).toBe("todo");
		// The snapshot keeps them, and a second call adds nothing.
		expect(TeamStateSchema.safeParse(r.team).success).toBe(true);
		expect(withSpawned(r.team, "plan_tasks").created).toEqual([]);
		// They run after the plan, in list order.
		expect(nextTeamStep(r.team)).toEqual({ kind: "start", taskId: "canvas" });
	});

	it("adds nothing for a task that does not spawn or is not approved", () => {
		let team = teamOf(studio());
		team = applyTask(team, "plan_tasks", { type: "START", agentId: "a1" }).team;
		team = applyTask(team, "plan_tasks", { type: "SUBMIT", report: LIST }).team;
		expect(withSpawned(team, "plan_tasks").created).toEqual([]);
	});

	it("gives a spawned task its acceptance sentences, and others none", () => {
		const { team } = withSpawned(approved(LIST), "plan_tasks");
		expect(acceptanceOf(team, "check")).toEqual(["check works"]);
		expect(acceptanceOf(team, "plan_tasks")).toEqual([]);
	});
});
