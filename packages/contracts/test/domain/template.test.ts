import { describe, expect, it } from "vitest";
import { parseTemplate } from "../../src/domain/template.js";

// The game-studio example of docs/08, Team template schema, as YAML parses it.
const gameStudio = () => ({
	apiVersion: "mete/v1",
	kind: "TeamTemplate",
	metadata: {
		id: "game-studio",
		name: "Game studio",
		version: "1.0.0",
		description: "Idea to playable prototype",
	},
	engine: "native",
	pattern: "hierarchical",
	roles: [
		{
			id: "designer",
			name: "Game designer",
			goal: "Turn the goal into a clear, buildable game design document",
			backstory: "Ten years of designing small, focused games",
			tier: "reasoning",
			needs: ["tool_calling"],
			prefer_different_family_than: [],
			capabilities: ["web.search@1", "web.fetch@1", "fs.read@1", "fs.write@1"],
			watches: [],
		},
		{
			id: "lead",
			name: "Lead",
			goal: "Approve or return work",
			tier: "reasoning",
			capabilities: ["fs.read@1", "vcs.git@2"],
			watches: ["gdd@1", "task-list@1"],
		},
		{
			id: "pm",
			name: "Project manager",
			goal: "Split approved designs into owned tasks",
			tier: "reasoning",
			capabilities: ["fs.read@1", "fs.write@1"],
		},
		{
			id: "developer",
			name: "Developer",
			goal: "Implement tasks",
			tier: "coder",
			capabilities: ["fs.*@1", "shell.exec@1", "gameengine.build@1"],
		},
		{
			id: "tester",
			name: "Tester",
			goal: "Prove that features work",
			tier: "coder",
			prefer_different_family_than: ["developer"],
			capabilities: ["fs.read@1", "3d.cleanup@1"],
		},
	],
	tasks: [
		{
			id: "write_gdd",
			role: "designer",
			title: "Write the game design document",
			expected_output: "artifact:gdd@1",
			before_start: { clarify_with: "human" },
			guardrail: { schema: "gdd@1", max_retries: 2 },
			approval: "lead",
		},
		{
			id: "plan_tasks",
			role: "pm",
			title: "Split the design into tasks",
			expected_output: "artifact:task-list@1",
			context: ["write_gdd"],
			approval: "lead",
			spawns: true,
		},
	],
	spawn_defaults: {
		developer: {
			verify: [{ capability: "gameengine.build@1" }],
			review: { pair_with: "tester", max_turns: 4 },
			approval: "lead",
		},
		tester: { verify: [{ run: "pnpm test" }], approval: "lead" },
	},
	policies: {
		revision_limit: 3,
		human_checkpoints: ["write_gdd"],
		retrospective: true,
	},
	budget: { cloud_requests: 150, max_hours: 6 },
});

const minimal = () => ({
	apiVersion: "mete/v1",
	kind: "TeamTemplate",
	metadata: { id: "solo", name: "Solo", version: "0.1.0" },
	pattern: "pipeline",
	roles: [
		{
			id: "writer",
			name: "Writer",
			goal: "Write",
			tier: "fast",
			capabilities: [],
		},
	],
	tasks: [
		{
			id: "draft",
			role: "writer",
			title: "Draft",
			guardrail: { schema: "lesson@1" },
			review: { pair_with: "writer" },
		},
	],
});

const issues = (input: unknown) => {
	const r = parseTemplate(input);
	return r.ok ? [] : r.error.issues;
};

describe("parseTemplate", () => {
	it("accepts the game-studio example of docs/08", () => {
		const r = parseTemplate(gameStudio());
		expect(r.ok && r.value.tasks[1]?.context).toEqual(["write_gdd"]);
	});

	it("fills the documented defaults", () => {
		const r = parseTemplate(minimal());
		if (!r.ok) throw new Error(r.error.issues.join("\n"));
		expect(r.value.engine).toBe("native");
		expect(r.value.policies).toEqual({
			revision_limit: 3,
			retrospective: false,
		});
		expect(r.value.budget).toEqual({ cloud_requests: 150, max_hours: 6 });
		expect(r.value.tasks[0]?.guardrail?.max_retries).toBe(2);
		expect(r.value.tasks[0]?.review?.max_turns).toBe(4);
	});

	it.each([
		["the template", (t: ReturnType<typeof minimal>) => ({ ...t, extra: 1 })],
		[
			"a role",
			(t: ReturnType<typeof minimal>) => ({
				...t,
				roles: [{ ...t.roles[0], model: "x" }],
			}),
		],
		[
			"a task",
			(t: ReturnType<typeof minimal>) => ({
				...t,
				tasks: [{ ...t.tasks[0], tool: "x" }],
			}),
		],
	])("rejects an unknown key in %s", (_, change) => {
		expect(issues(change(minimal()))).toHaveLength(1);
	});

	it("accepts a wildcard only for the fs domain", () => {
		const t = gameStudio();
		t.roles[0] = { ...t.roles[0], capabilities: ["web.*@1"] } as never;
		expect(issues(t)).toEqual([
			expect.stringContaining("roles.0.capabilities.0"),
		]);
	});

	it("rejects an output that is not an artifact ref", () => {
		const t = minimal();
		const task = { ...t.tasks[0], expected_output: "gdd@1" };
		expect(issues({ ...t, tasks: [task] })).toEqual([
			expect.stringContaining("tasks.0.expected_output"),
		]);
	});

	it("names every reference to a role or task that does not exist", () => {
		const t = gameStudio();
		t.tasks[1] = {
			...t.tasks[1],
			role: "ghost",
			context: ["nope"],
			approval: "boss",
		} as never;
		t.spawn_defaults = { artist: { approval: "lead" } } as never;
		t.policies.human_checkpoints = ["later"];
		t.roles[4] = {
			...t.roles[4],
			prefer_different_family_than: ["x"],
		} as never;
		expect(issues(t)).toEqual([
			"roles.4.prefer_different_family_than: unknown role x",
			"tasks.1.role: unknown role ghost",
			"tasks.1.context: unknown task nope",
			"tasks.1.approval: unknown role boss",
			"spawn_defaults.artist: unknown role artist",
			"policies.human_checkpoints: unknown task later",
		]);
	});

	it("refuses a pair reviewer that is also the task's approver (ADR-136)", () => {
		const t = minimal();
		const task = { ...t.tasks[0], approval: "writer" };
		expect(issues({ ...t, tasks: [task] })).toEqual([
			"tasks.0.review: the pair reviewer writer is also the approver",
		]);
	});

	it("names the circle when tasks wait for each other, even through one task alone", () => {
		const t = minimal();
		const task = (id: string, context: string[]) =>
			({ ...t.tasks[0], id, context }) as never;
		const ring = {
			...t,
			tasks: [task("a", ["c"]), task("b", ["a"]), task("c", ["b"])],
		};
		expect(issues(ring)).toEqual([
			"tasks: tasks wait for each other in a circle: a -> c -> b -> a",
		]);
		const alone = { ...t, tasks: [task("a", ["a"])] };
		expect(issues(alone)).toEqual([
			"tasks: tasks wait for each other in a circle: a -> a",
		]);
		// A task two others wait for is no circle.
		const diamond = {
			...t,
			tasks: [
				task("a", []),
				task("b", ["a"]),
				task("c", ["a"]),
				task("d", ["b", "c"]),
			],
		};
		expect(issues(diamond)).toEqual([]);
	});

	it("rejects duplicate ids and a role named human", () => {
		const t = minimal();
		const role = t.roles[0];
		const human = { ...role, id: "human" };
		const twice = {
			...t,
			roles: [role, role, human],
			tasks: [t.tasks[0], t.tasks[0]],
		};
		expect(issues(twice)).toEqual([
			"roles: role writer is defined twice",
			"tasks: task draft is defined twice",
			"roles: human is reserved for the user",
		]);
	});
});
