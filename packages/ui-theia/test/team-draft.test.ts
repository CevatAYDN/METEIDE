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
	idleMembers,
	issuesOf,
	removeRole,
	removeTask,
	teamOf,
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
