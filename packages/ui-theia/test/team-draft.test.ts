import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addRole,
	addTask,
	capabilityHints,
	copyAs,
	draftOf,
	edited,
	guardrailHints,
	idleMembers,
	issuesOf,
	removeRole,
	removeTask,
	renameRole,
	roleNames,
	runsOf,
	selectedAfterRemove,
	teamOf,
	withCheckpoint,
	withRuns,
} from "../src/application/team-draft.js";

// The team editor's draft (ADR-075): a template's YAML document edited in place, read for the screen
// and checked by TeamTemplateSchema alone, without Theia.

const WEB_DEV = readFileSync(
	join(__dirname, "..", "..", "..", "templates", "web-dev.yaml"),
	"utf8",
);
const draft = (text = WEB_DEV) => {
	const d = draftOf(text);
	if (!d.ok) throw new Error(d.error);
	return d.value;
};

describe("draftOf and teamOf", () => {
	it("reads a built-in template's team, members and tasks, and finds it valid", () => {
		const doc = draft();
		const team = teamOf(doc);
		expect(team.metadata.id).toBe("web-dev");
		expect(team.roles.length).toBeGreaterThan(1);
		expect(team.roles[1]?.capabilities).toEqual(["fs.*@1", "shell.exec@1"]);
		expect(team.tasks.length).toBeGreaterThan(0);
		expect(issuesOf(doc)).toEqual([]);
	});

	it("refuses text that is not YAML, and reads a document of the wrong shape as an empty team", () => {
		expect(draftOf("roles: [").ok).toBe(false);
		const odd = draft("roles: 3\nmetadata: x\n");
		expect(teamOf(odd)).toMatchObject({
			metadata: { id: "", name: "" },
			roles: [],
			tasks: [],
		});
		expect(issuesOf(odd).length).toBeGreaterThan(0);
	});
});

describe("editing", () => {
	it("adds a member with a fresh id on the coder tier, which the schema refuses until it has a name and a goal", () => {
		const doc = addRole(draft());
		const added = teamOf(doc).roles.at(-1);
		expect(added).toMatchObject({ id: "member", tier: "coder", goal: "" });
		expect(teamOf(addRole(doc)).roles.at(-1)?.id).toBe("member_2");
		expect(issuesOf(doc).map((i) => i.split(":")[0])).toEqual([
			`roles.${teamOf(doc).roles.length - 1}.name`,
			`roles.${teamOf(doc).roles.length - 1}.goal`,
		]);
		const index = teamOf(doc).roles.length - 1;
		const named = edited(doc, ["roles", index, "name"], "Copy editor");
		const filled = edited(named, ["roles", index, "goal"], "Check the copy");
		expect(issuesOf(filled)).toEqual([]);
	});

	it("never changes the draft it was given", () => {
		const doc = draft();
		const before = doc.toString();
		addRole(doc);
		edited(doc, ["metadata", "name"], "Mine");
		removeRole(doc, 0);
		expect(doc.toString()).toBe(before);
	});

	it("sets a field and removes an optional one given undefined, keeping the file's comments", () => {
		const text = `# my team\n${WEB_DEV}`;
		const doc = edited(draft(text), ["metadata", "name"], "My web team");
		expect(teamOf(doc).metadata.name).toBe("My web team");
		expect(doc.toString()).toContain("# my team");
		const caps = ["fs.read@1", "web.search@1"];
		const withCaps = edited(doc, ["roles", 0, "capabilities"], caps);
		expect(teamOf(withCaps).roles[0]?.capabilities).toEqual(caps);
		const noDesc = edited(doc, ["metadata", "description"], undefined);
		expect(teamOf(noDesc).metadata.description).toBeUndefined();
		expect(issuesOf(noDesc)).toEqual([]);
	});

	it("names a removed member that a task still needs among the schema's issues", () => {
		const doc = draft();
		const used = teamOf(doc).tasks[0]?.role;
		const at = teamOf(doc).roles.findIndex((r) => r.id === used);
		const issues = issuesOf(removeRole(doc, at));
		expect(issues.join("\n")).toContain(String(used));
	});

	it("drops a removed member's spawn defaults and the other members' family preference for it, which no control shows", () => {
		const studio = draft(
			readFileSync(
				join(__dirname, "..", "..", "..", "templates", "game-studio.yaml"),
				"utf8",
			),
		);
		const at = (id: string) =>
			teamOf(studio).roles.findIndex((r) => r.id === id);
		const issues = issuesOf(removeRole(studio, at("developer"))).join("\n");
		expect(issues).not.toContain("spawn_defaults");
		expect(issues).not.toContain("prefer_different_family_than");
		expect(
			teamOf(removeRole(studio, at("developer"))).roles.map(
				(r) => r.prefer_different_family_than,
			),
		).not.toContainEqual(["developer"]);
	});

	it("adds a task for a member, which then is no longer idle, and removes it again", () => {
		const doc = addRole(draft());
		const member = teamOf(doc).roles.at(-1)?.id ?? "";
		expect(idleMembers(teamOf(doc))).toContain(member);
		const withTask = addTask(doc, member);
		const task = teamOf(withTask).tasks.at(-1);
		expect(task).toMatchObject({ id: `${member}_task`, role: member });
		expect(idleMembers(teamOf(withTask))).not.toContain(member);
		const index = teamOf(withTask).tasks.length - 1;
		expect(teamOf(removeTask(withTask, index)).tasks).toEqual(
			teamOf(doc).tasks,
		);
	});

	it("copies the team under a new id and name", () => {
		const copy = copyAs(draft(), "my-web", "My web");
		expect(teamOf(copy).metadata).toMatchObject({
			id: "my-web",
			name: "My web",
		});
		expect(issuesOf(copy)).toEqual([]);
	});
});

describe("capabilityHints", () => {
	it("offers each capability id the team's members use, once and sorted", () => {
		const hints = capabilityHints(teamOf(draft()));
		expect(hints).toEqual([...new Set(hints)].sort());
		expect(hints.length).toBeGreaterThan(0);
	});
});

const GAME = readFileSync(
	join(__dirname, "..", "..", "..", "templates", "game-studio.yaml"),
	"utf8",
);

describe("the rules of the work", () => {
	it("reads gates, guardrails, spawn defaults, checkpoints and the budget", () => {
		const team = teamOf(draft(GAME));
		expect(team.tasks[0]?.guardrail).toEqual({
			schema: "gdd@1",
			max_retries: 2,
		});
		expect(runsOf(team.spawn_defaults.developer?.verify ?? [])).toEqual([]);
		expect(team.policies).toMatchObject({
			revision_limit: 3,
			human_checkpoints: ["write_gdd"],
		});
		expect(team.budget).toEqual({ cloud_requests: 150, max_hours: 6 });
		expect(runsOf(teamOf(draft()).tasks[1]?.verify ?? [])).toEqual([
			"npm run build",
		]);
	});

	it("changes a task's commands and keeps its capability gates, which the screen does not edit", () => {
		const gates = [{ capability: "gameengine.build@1", args: { a: 1 } }];
		expect(withRuns(gates, ["npm test"])).toEqual([
			...gates,
			{ run: "npm test" },
		]);
		expect(withRuns([{ run: "npm test" }], [])).toBeUndefined();
	});

	it("turns the human checkpoint of a task on and off, and drops it with the task", () => {
		const doc = draft(GAME);
		const on = withCheckpoint(doc, "plan_tasks", true);
		expect(teamOf(on).policies.human_checkpoints).toEqual([
			"write_gdd",
			"plan_tasks",
		]);
		const off = withCheckpoint(on, "write_gdd", false);
		expect(teamOf(off).policies.human_checkpoints).toEqual(["plan_tasks"]);
		const gone = removeTask(off, 1);
		expect(teamOf(gone).policies.human_checkpoints).toEqual([]);
		expect(gone.hasIn(["policies", "human_checkpoints"])).toBe(false);
		expect(issuesOf(gone)).toEqual([]);
	});

	it("refuses a guardrail whose artifact type has no schema, as core does when it loads the team", () => {
		const doc = edited(
			draft(GAME),
			["tasks", 0, "guardrail", "schema"],
			"asset@1",
		);
		expect(issuesOf(doc)).toContain(
			"tasks.0.guardrail.schema: asset@1 has no schema yet",
		);
	});

	it("offers as guardrails the team's output types that have a schema", () => {
		expect(guardrailHints(teamOf(draft(GAME)))).toEqual([
			"asset-spec@1",
			"gdd@1",
			"task-list@1",
			"test-report@1",
		]);
	});
});

describe("a section the file does not have yet", () => {
	it("is made by the first edit inside it", () => {
		const doc = edited(
			withCheckpoint(draft(), "build", true),
			["spawn_defaults", "qa", "approval"],
			"lead",
		);
		const team = teamOf(doc);
		expect(team.spawn_defaults.qa?.approval).toBe("lead");
		expect(team.policies.human_checkpoints).toEqual(["build"]);
		expect(issuesOf(doc)).toEqual([]);
	});
});

describe("renameRole", () => {
	it("moves the member's tasks, spawn defaults, approvals and family preferences to its new id", () => {
		let doc = addRole(draft(GAME));
		const index = teamOf(doc).roles.length - 1;
		doc = addTask(doc, "member");
		doc = edited(doc, ["spawn_defaults", "member", "approval"], "lead");
		doc = edited(doc, ["tasks", 0, "approval"], "member");
		doc = edited(doc, ["roles", 0, "prefer_different_family_than"], ["member"]);
		doc = edited(doc, ["roles", index, "name"], "Writer");
		doc = edited(doc, ["roles", index, "goal"], "Write");
		doc = edited(doc, ["tasks", 2, "title"], "Write it");
		const result = renameRole(doc, index, "writer");
		if (!result.ok) throw new Error(result.error.taken);
		const renamed = result.value;
		const team = teamOf(renamed);
		expect(team.roles[index]?.id).toBe("writer");
		expect(team.tasks.map((t) => t.role)).toContain("writer");
		expect(team.tasks[0]?.approval).toBe("writer");
		expect(team.spawn_defaults.writer?.approval).toBe("lead");
		expect(team.spawn_defaults.member).toBeUndefined();
		expect(team.roles[0]?.prefer_different_family_than).toEqual(["writer"]);
		expect(issuesOf(renamed)).toEqual([]);
	});

	it("refuses an id another member has, naming it", () => {
		const doc = addRole(draft(GAME));
		const index = teamOf(doc).roles.length - 1;
		expect(renameRole(doc, index, "lead")).toEqual({
			ok: false,
			error: { taken: "lead" },
		});
	});
});

describe("roleNames", () => {
	it("names each member by its id for the Team view, and none for text that does not parse (ADR-089)", () => {
		expect(roleNames(WEB_DEV)).toEqual({
			ui_designer: "UI designer",
			frontend_developer: "Frontend developer",
			qa: "QA",
			lead: "Lead",
		});
		expect(roleNames("roles: [")).toEqual({});
	});
});

describe("selectedAfterRemove (ADR-093)", () => {
	it("keeps the chosen member when one after it leaves, and moves to the one before when it or one before it leaves", () => {
		expect(selectedAfterRemove(1, 3, 3)).toBe(1);
		expect(selectedAfterRemove(2, 0, 3)).toBe(1);
		expect(selectedAfterRemove(2, 2, 3)).toBe(1);
	});

	it("stays on the first member, and never past the last", () => {
		expect(selectedAfterRemove(0, 0, 2)).toBe(0);
		expect(selectedAfterRemove(0, 0, 0)).toBe(0);
		expect(selectedAfterRemove(5, 9, 2)).toBe(1);
	});
});
