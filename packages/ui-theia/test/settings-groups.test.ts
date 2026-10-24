import { describe, expect, it } from "vitest";
import { groupsOf } from "../src/application/settings-groups.js";

// The Settings groups (ADR-095): labels over the sections that exist; none is dropped.

const named = (...names: string[]) => names.map((name) => ({ name }));
const KNOWN = named(
	"providers",
	"gateway",
	"models",
	"quota",
	"policy",
	"privacy",
	"workspace",
	"bindings",
	"mcp",
	"shell",
);
const ids = (groups: ReturnType<typeof groupsOf>) =>
	Object.fromEntries(groups.map((g) => [g.id, g.sections.map((s) => s.name)]));

describe("groupsOf", () => {
	it("puts each section the modules read in its group, in the list's order, and shows no Other files without a stray one", () => {
		expect(ids(groupsOf(KNOWN))).toEqual({
			models: ["providers", "gateway", "models", "quota"],
			limits: ["policy"],
			privacy: ["privacy", "workspace"],
			tools: ["bindings", "mcp", "shell"],
			teams: [],
			look: [],
		});
	});

	it("keeps a section no group names, such as a stray .mete/foo.yaml, in Other files at the end", () => {
		const groups = groupsOf([...KNOWN, ...named("foo", "bar")]);
		expect(groups.at(-1)?.id).toBe("other");
		expect(groups.at(-1)?.sections.map((s) => s.name)).toEqual(["foo", "bar"]);
	});

	it("holds every section exactly once, whatever its name", () => {
		const all = named("zzz", ...KNOWN.map((s) => s.name), "a");
		const held = groupsOf(all).flatMap((g) => g.sections.map((s) => s.name));
		expect(held.sort()).toEqual(all.map((s) => s.name).sort());
	});

	it("marks a group when a section of it has a value in this folder's own file", () => {
		const groups = groupsOf([
			{ name: "policy", workspace: { file: "/w/.mete/policy.yaml" } },
			{ name: "gateway" },
			{ name: "foo" },
		]);
		const changed = Object.fromEntries(
			groups.map((g) => [g.id, g.changedHere]),
		);
		expect(changed).toMatchObject({
			limits: true,
			models: false,
			privacy: false,
			other: false,
		});
	});

	it("leads the teams group to Edit team and New team, and the look group to Theia's own settings", () => {
		const links = Object.fromEntries(groupsOf([]).map((g) => [g.id, g.links]));
		expect(links.teams).toEqual(["mete.team.edit", "mete.team.new"]);
		expect(links.look).toEqual([
			"preferences:open",
			"workbench.action.configureLanguage",
		]);
		expect(links.models).toEqual(["mete.key.set"]);
	});
});
