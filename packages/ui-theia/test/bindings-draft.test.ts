import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
	type BindingsDraft,
	bindingsOf,
	bindingsText,
} from "../src/application/bindings-draft.js";

// The bindings form's file (ADR-096): a capability map in .mete/bindings.yaml, or under bindings in
// the global settings.yaml, edited as rows without losing the file's comments or other sections.

const rowsOf = (text: string | undefined, target: "workspace" | "global") => {
	const r = bindingsOf(text, target);
	if (!r.ok) throw new Error(r.error);
	return r.value;
};

const textOf = (
	text: string | undefined,
	target: "workspace" | "global",
	rows: BindingsDraft,
) => {
	const r = bindingsText(text, target, rows);
	if (!r.ok) throw new Error(r.error);
	return r.value;
};

describe("bindingsOf", () => {
	it("reads a workspace file in its order", () => {
		expect(
			rowsOf(
				"web.search@1: [exa-mcp, tavily]\n3d.cleanup@1: [blender-mcp]\n",
				"workspace",
			),
		).toEqual([
			{ capability: "web.search@1", adapters: "exa-mcp, tavily" },
			{ capability: "3d.cleanup@1", adapters: "blender-mcp" },
		]);
	});

	it("reads the bindings section of the global settings file", () => {
		expect(
			rowsOf(
				"gateway:\n  models: free\nbindings:\n  web.search@1: [exa-mcp]\n",
				"global",
			),
		).toEqual([{ capability: "web.search@1", adapters: "exa-mcp" }]);
	});

	it("sets no rows for a missing file or section", () => {
		expect(rowsOf(undefined, "workspace")).toEqual([]);
		expect(rowsOf("gateway:\n  models: free\n", "global")).toEqual([]);
	});

	it("refuses a value that is not a list or a section that is not a map", () => {
		const list = bindingsOf("web.search@1: exa-mcp\n", "workspace");
		expect(list.ok).toBe(false);
		expect(list.ok ? "" : list.error).toContain("expected a list");
		const map = bindingsOf("bindings: nope\n", "global");
		expect(map.ok).toBe(false);
		expect(map.ok ? "" : map.error).toContain("expected a map");
	});
});

describe("bindingsText", () => {
	it("writes rows as a capability map and keeps a comment", () => {
		const out = textOf(
			"# fallback order\nweb.search@1: [exa-mcp]\n",
			"workspace",
			[
				{ capability: "web.search@1", adapters: "exa-mcp, tavily" },
				{ capability: "3d.cleanup@1", adapters: "blender-mcp" },
			],
		);
		expect(out).toContain("# fallback order");
		expect(parse(out)).toEqual({
			"web.search@1": ["exa-mcp", "tavily"],
			"3d.cleanup@1": ["blender-mcp"],
		});
	});

	it("removes a row the form no longer has", () => {
		const out = textOf(
			"web.search@1: [exa-mcp]\n3d.cleanup@1: [blender-mcp]\n",
			"workspace",
			[{ capability: "web.search@1", adapters: "exa-mcp" }],
		);
		expect(parse(out)).toEqual({ "web.search@1": ["exa-mcp"] });
	});

	it("writes nothing when the form has no rows", () => {
		expect(textOf("web.search@1: [exa-mcp]\n", "workspace", [])).toBe("");
	});

	it("adds the bindings section to a global file that has other sections", () => {
		const out = textOf("gateway:\n  models: free\n", "global", [
			{ capability: "web.search@1", adapters: "tavily" },
		]);
		expect(parse(out)).toEqual({
			gateway: { models: "free" },
			bindings: { "web.search@1": ["tavily"] },
		});
	});

	it("keeps the other sections when the global bindings go", () => {
		const out = textOf(
			"gateway:\n  models: free\nbindings:\n  web.search@1: [exa-mcp]\n",
			"global",
			[],
		);
		expect(parse(out)).toEqual({ gateway: { models: "free" } });
	});

	it("refuses a bad capability, an empty adapter list and a duplicate", () => {
		const badId = bindingsText(undefined, "workspace", [
			{ capability: "web-search", adapters: "exa-mcp" },
		]);
		expect(badId.ok).toBe(false);
		expect(badId.ok ? "" : badId.error).toContain("expected a capability id");
		const empty = bindingsText(undefined, "workspace", [
			{ capability: "web.search@1", adapters: " , " },
		]);
		expect(empty.ok).toBe(false);
		expect(empty.ok ? "" : empty.error).toContain("at least one adapter");
		const twice = bindingsText(undefined, "workspace", [
			{ capability: "web.search@1", adapters: "exa-mcp" },
			{ capability: "web.search@1", adapters: "tavily" },
		]);
		expect(twice.ok).toBe(false);
		expect(twice.ok ? "" : twice.error).toContain("may appear once");
	});
});
