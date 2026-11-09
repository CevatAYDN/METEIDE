import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CommandGateFields } from "../src/application/command-gate-fields.js";
import { draftOf, edited, teamOf } from "../src/application/team-draft.js";
import { Work } from "../src/application/work-fields.js";

const source = `apiVersion: mete/v2
tasks:
  - id: task
    verify:
      - run: check # optional command
        optional: true
      - capability: fs.read@1 # capability comment
        args: { path: report }
      - run: check # required command
        optional: false
`;
const draft = () => {
	const result = draftOf(source);
	if (!result.ok) throw new Error(result.error);
	return result.value;
};
type Control = {
	readonly children?: ReactNode;
	readonly "aria-label"?: string;
	readonly onClick?: () => void;
	readonly onChange?: (event: { target: { value: string } }) => void;
};
const controls = (node: ReactNode): readonly Control[] =>
	Children.toArray(node).flatMap((child): Control[] =>
		isValidElement<Control>(child)
			? [child.props, ...controls(child.props.children)]
			: [],
	);
const setup = () => {
	let doc = draft();
	const shown = () => {
		const gates = teamOf(doc).tasks[0]?.verify ?? [];
		return CommandGateFields({
			gates,
			base: ["tasks", 0],
			onEdit: (path, value) => {
				doc = edited(doc, path, value);
			},
		});
	};
	return {
		doc: () => doc,
		act: (label: string) => {
			const control = controls(shown()).find((p) => p["aria-label"] === label);
			if (!control) throw new Error(`Missing control: ${label}`);
			return control;
		},
	};
};

it.each([1, 3])(
	"removes only duplicate command gate %s and preserves surviving YAML nodes",
	(position) => {
		const t = setup();
		t.act(`Remove command gate ${position}`).onClick?.();
		const remaining = teamOf(t.doc()).tasks[0]?.verify;
		expect(remaining).toEqual(
			position === 1
				? [
						{ capability: "fs.read@1", args: { path: "report" } },
						{ run: "check", optional: false },
					]
				: [
						{ run: "check", optional: true },
						{ capability: "fs.read@1", args: { path: "report" } },
					],
		);
		expect(t.doc().toString()).toContain("# capability comment");
		expect(t.doc().toString()).toContain(
			position === 1 ? "# required command" : "# optional command",
		);
		expect(t.doc().get("apiVersion")).toBe("mete/v2");
	},
);

it("renames one duplicate in place and appends another without changing optionality or comments", () => {
	const t = setup();
	t.act("Gate 3 command").onChange?.({ target: { value: "build" } });
	t.act("Add command check").onClick?.();
	t.act("Gate 4 command").onChange?.({ target: { value: "check" } });
	expect(teamOf(t.doc()).tasks[0]?.verify).toEqual([
		{ run: "check", optional: true },
		{ capability: "fs.read@1", args: { path: "report" } },
		{ run: "build", optional: false },
		{ run: "check" },
	]);
	for (const comment of [
		"# optional command",
		"# capability comment",
		"# required command",
	])
		expect(t.doc().toString()).toContain(comment);
});

it("uses positional command controls in Work Advanced, not shared text-keyed chips", () => {
	const doc = draft();
	const team = teamOf(doc);
	const out = renderToStaticMarkup(
		createElement(Work, {
			team,
			work: { verify: team.tasks[0]?.verify ?? [] },
			base: ["tasks", 0],
			hints: [],
			onEdit: () => {},
		}),
	);
	expect(out).toContain('aria-label="Remove command gate 1"');
	expect(out).toContain('aria-label="Remove command gate 3"');
	expect(out).not.toContain('title="Remove check"');
	expect(out).toMatch(/<details[^>]*><summary>Advanced:/);
});
