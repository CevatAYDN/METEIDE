import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CommandGateOptions } from "../src/application/command-gate-options.js";
import type { Tick } from "../src/application/fields.js";
import {
	blankDraft,
	copyAs,
	draftOf,
	edited,
	teamOf,
	withRuns,
} from "../src/application/team-draft.js";

const gates = [
	{ run: "check", optional: true },
	{ capability: "fs.read@1", args: { path: "report" }, optional: true },
	{ run: "check", optional: false },
];
const draft = (version: string) => {
	const parsed = draftOf(`# keep my version
apiVersion: ${version}
tasks:
  - id: task
    verify:
      - { run: check, optional: true }
      - { capability: fs.read@1, args: { path: report }, optional: true }
      - { run: check, optional: false }
`);
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.value;
};

it("authors new templates as v2 without migrating read/edit/copy of an existing v1 file", () => {
	expect(blankDraft("new-team", "New team").get("apiVersion")).toBe("mete/v2");
	const doc = draft("mete/v1");
	const before = doc.toString();
	expect(teamOf(doc).apiVersion).toBe("mete/v1");
	expect(edited(doc, ["metadata", "name"], "Renamed").get("apiVersion")).toBe(
		"mete/v1",
	);
	expect(copyAs(doc, "copy", "Copy").get("apiVersion")).toBe("mete/v1");
	expect(doc.toString()).toBe(before);
});

it("preserves explicit true/false optionality and capability gates through command editing", () => {
	const next = withRuns(gates, ["replacement", "check", "added"]);
	expect(next).toEqual([
		{ run: "replacement", optional: true },
		gates[1],
		gates[2],
		{ run: "added" },
	]);
	const doc = edited(draft("mete/v2"), ["tasks", 0, "verify"], next);
	const reopened = draftOf(doc.toString());
	if (!reopened.ok) throw new Error(reopened.error);
	expect(teamOf(reopened.value).tasks[0]?.verify).toEqual(next);
	expect(doc.get("apiVersion")).toBe("mete/v2");
	expect(doc.toString()).toContain("# keep my version");
});

it("offers v2 command optionality at exact positions, not command text or capability gates", () => {
	const onEdit = vi.fn();
	const props = { version: "mete/v2", gates, base: ["tasks", 0], onEdit };
	const out = renderToStaticMarkup(createElement(CommandGateOptions, props));
	expect(out).toContain("Gate 1: check (optional)");
	expect(out).toContain("Gate 3: check (optional)");
	expect(out).not.toContain("Gate 2");
	expect(out.match(/type="checkbox"/g)).toHaveLength(2);
	expect(out.match(/checked=""/g)).toHaveLength(1);
	const node = CommandGateOptions(props);
	if (node?.type !== "fieldset") throw new Error("Expected command options");
	const ticks = node.props.children[1] as readonly ReactElement<
		Parameters<typeof Tick>[0]
	>[];
	ticks[1]?.props.onChange(true);
	expect(onEdit).toHaveBeenCalledExactlyOnceWith(
		["tasks", 0, "verify", 2, "optional"],
		true,
	);
});

it("discloses v1 required semantics without optional controls or automatic edits", () => {
	const onEdit = vi.fn();
	const out = renderToStaticMarkup(
		createElement(CommandGateOptions, {
			version: "mete/v1",
			gates,
			base: ["spawn_defaults", "writer"],
			onEdit,
		}),
	);
	expect(out).toContain(
		"mete/v1: all checks are required in new runs. Optional checks require mete/v2.",
	);
	expect(out).not.toContain('type="checkbox"');
	expect(onEdit).not.toHaveBeenCalled();
});
