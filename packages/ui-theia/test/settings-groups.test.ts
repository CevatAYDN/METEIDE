import { nls } from "@theia/core/lib/common/nls";
import { describe, expect, it } from "vitest";
import {
	groupsOf,
	SETTINGS_LINKS,
	searchGroups,
} from "../src/application/settings-groups.js";

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
const ids = (groups: Readonly<ReturnType<typeof groupsOf>>) =>
	Object.fromEntries(groups.map((g) => [g.id, g.sections.map((s) => s.name)]));

describe("groupsOf", () => {
	it("puts each section the modules read in its group, in the list's order, and shows no Other files without a stray one", () => {
		expect(ids(groupsOf(KNOWN))).toEqual({
			models: ["providers", "gateway", "models", "quota"],
			limits: ["policy"],
			privacy: ["privacy", "workspace"],
			tools: ["mcp", "bindings", "shell"],
			skills: [],
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
		expect(links.tools).toContain("vsxExtensions.toggle");
	});
});

describe("settings search", () => {
	const groups = groupsOf([...KNOWN, ...named("custom-file")]);

	it("finds the existing policy group by permissions and approvals", () => {
		expect(ids(searchGroups(groups, "permissions"))).toEqual({
			limits: ["policy"],
		});
		expect(ids(searchGroups(groups, "approvals"))).toEqual({
			limits: ["policy"],
			skills: [],
		});
	});

	it("finds Turkish permission terminology from the visible group label", () => {
		const previous = nls.localization;
		nls.localization = {
			languageId: "tr",
			translations: {
				"mete/groups/limits": "İzinler ve onaylar",
				"mete/groups/skillsHint": "Yerel kaynaklar ve sürüm onayları",
			},
		};
		try {
			for (const query of ["izin", "İZİNLER"])
				expect(ids(searchGroups(groupsOf(KNOWN), query))).toEqual({
					limits: ["policy"],
				});
			expect(ids(searchGroups(groupsOf(KNOWN), "onay"))).toEqual({
				limits: ["policy"],
				skills: [],
			});
		} finally {
			nls.localization = previous;
		}
	});

	it("keeps all categories for an empty or whitespace query", () => {
		expect(searchGroups(groups, "  ")).toEqual(groups);
	});

	it("matches a category label and retains all its sections and navigation", () => {
		const result = searchGroups(groups, "MODELS AND KEYS");
		expect(ids(result)).toEqual({
			models: ["providers", "gateway", "models", "quota"],
		});
		expect(result[0]?.links).toEqual(["mete.key.set"]);
		expect(ids(groups).tools).toEqual(["mcp", "bindings", "shell"]);
	});

	it("matches translated labels, section titles and IDs without case or accent sensitivity", () => {
		expect(ids(searchGroups(groups, "daily spend"))).toEqual({
			models: ["gateway"],
		});
		expect(ids(searchGroups(groups, "mcp"))).toEqual({ tools: ["mcp"] });
		expect(ids(searchGroups(groups, "custom-file"))).toEqual({
			other: ["custom-file"],
		});
		const translated = groups.map((group) => ({ ...group, label: "Gizlilik" }));
		expect(searchGroups(translated, "GİZLİLİK")).toEqual(translated);
	});

	it("finds categories without sections, and returns no invented result", () => {
		expect(searchGroups(groups, "Look and language")[0]?.id).toBe("look");
		expect(searchGroups(groups, "not-a-setting")).toEqual([]);
	});

	it.each(["  THEME  ", "fonts"])(
		"finds native appearance navigation through the hint %s without sections",
		(query) => {
			const result = searchGroups(groupsOf([]), query);
			expect(ids(result)).toEqual({ look: [] });
			expect(result[0]?.links).toEqual([
				"preferences:open",
				"workbench.action.configureLanguage",
			]);
		},
	);

	it("uses a hint-only match as a fallback to the unchanged whole group", () => {
		const source = groupsOf(
			KNOWN.map((section) =>
				section.name === "mcp"
					? { ...section, workspace: { configured: true } }
					: section,
			),
		);
		const tools = source.find((group) => group.id === "tools");
		const result = searchGroups(source, "adapters, mcp");
		expect(result).toEqual([tools]);
		expect(result[0]).toBe(tools);
		expect(result[0]?.changedHere).toBe(true);
		expect(result[0]?.links).toEqual(["vsxExtensions.toggle"]);
	});

	it("keeps section matches narrower than matching hints", () => {
		const result = searchGroups(groups, "MCP");
		expect(ids(result)).toEqual({ tools: ["mcp"] });
		expect(result[0]?.links).toEqual(["vsxExtensions.toggle"]);
		expect(ids(groups).tools).toEqual(["mcp", "bindings", "shell"]);
	});

	it("prefers the category label over matching sections", () => {
		const source = groups.map((group) =>
			group.id === "tools" ? { ...group, label: "MCP" } : group,
		);
		expect(ids(searchGroups(source, "mcp"))).toEqual({
			tools: ["mcp", "bindings", "shell"],
		});
	});

	it.each([
		[
			"Preferences",
			"look",
			["preferences:open", "workbench.action.configureLanguage"],
		],
		[
			"Display language",
			"look",
			["preferences:open", "workbench.action.configureLanguage"],
		],
		["EDITOR EXTENSIONS", "tools", ["vsxExtensions.toggle"]],
		["Edit team", "teams", ["mete.team.edit", "mete.team.new"]],
		["New team", "teams", ["mete.team.edit", "mete.team.new"]],
		["Set provider key", "models", ["mete.key.set"]],
	] as const)(
		"finds existing navigation by the visible action label %s",
		(query, id, links) => {
			const result = searchGroups(groupsOf([]), query);
			expect(ids(result)).toEqual({ [id]: [] });
			expect(result[0]?.links).toEqual(links);
		},
	);

	it("retains every section when an action label is the only match", () => {
		expect(ids(searchGroups(groups, "Editor extensions"))).toEqual({
			tools: ["mcp", "bindings", "shell"],
		});
		expect(ids(searchGroups(groups, "Set provider key"))).toEqual({
			models: ["providers", "gateway", "models", "quota"],
		});
	});

	it("matches Turkish hints and action labels through the existing localization API", () => {
		const previous = nls.localization;
		nls.localization = {
			languageId: "tr",
			translations: {
				"mete/groups/lookHint": "Tema, yazı tipleri ve görüntüleme dili",
				"mete/settings/preferences": "Tercihler",
				"mete/settings/language": "Görüntüleme dili",
				"mete/settings/extensions": "Düzenleyici eklentileri",
			},
		};
		try {
			const translated = groupsOf([]);
			expect(ids(searchGroups(translated, "TEMA"))).toEqual({ look: [] });
			expect(ids(searchGroups(translated, "yazı tipleri"))).toEqual({
				look: [],
			});
			expect(ids(searchGroups(translated, "YAZI TİPLERİ"))).toEqual({
				look: [],
			});
			expect(ids(searchGroups(translated, "TERCİHLER"))).toEqual({ look: [] });
			expect(ids(searchGroups(translated, "GÖRÜNTÜLEME DİLİ"))).toEqual({
				look: [],
			});
			const result = searchGroups(translated, "DÜZENLEYİCİ EKLENTİLERİ");
			expect(ids(result)).toEqual({ tools: [] });
			expect(result[0]?.links).toEqual(["vsxExtensions.toggle"]);
			expect(searchGroups(translated, "Editor extensions")).toEqual([]);
		} finally {
			nls.localization = previous;
		}
	});

	it("does not search command IDs or unknown and unlinked actions", () => {
		for (const [id] of SETTINGS_LINKS)
			expect(searchGroups(groups, id)).toEqual([]);
		const unlinked = groupsOf([]).map((group) => ({
			...group,
			links: ["unregistered.setting.action", "constructor", "__proto__"],
		}));
		expect(searchGroups(unlinked, "unregistered.setting.action")).toEqual([]);
		expect(searchGroups(unlinked, "constructor")).toEqual([]);
		expect(searchGroups(unlinked, "__proto__")).toEqual([]);
		expect(searchGroups(unlinked, "Editor extensions")).toEqual([]);
	});

	it("does not search configuration values, source paths or fixture secrets", () => {
		const source = groupsOf([
			{
				name: "mcp",
				merged: { url: "https://fixture.invalid/private-endpoint" },
				global: { apiKey: "fixture-global-secret" },
				workspace: {
					file: "/fixture/private-settings.yaml",
					value: { apiKey: "fixture-workspace-secret" },
				},
			},
		]);
		for (const query of [
			"private-endpoint",
			"fixture-global-secret",
			"private-settings.yaml",
			"fixture-workspace-secret",
		])
			expect(searchGroups(source, query)).toEqual([]);
		expect(ids(searchGroups(source, "MCP"))).toEqual({ tools: ["mcp"] });
	});
});
