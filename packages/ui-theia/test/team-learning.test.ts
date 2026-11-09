import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OnEdit } from "../src/application/fields.js";
import {
	type Draft,
	draftOf,
	edited,
	teamOf,
} from "../src/application/team-draft.js";
import { TeamLearning } from "../src/application/team-learning.js";
import { required } from "./required-fixture.js";

const fixture = () => {
	const loaded = draftOf(`# Keep this team note.
roles:
  - { id: lead, name: Planner }
  - { id: writer, name: Writer }
  - { id: spare, name: Spare }
tasks:
  - { id: plan, role: lead, title: Plan work, spawns: true, memory: { write_lessons: false }, verify: [{ run: check }], extra: keep }
  - { id: write, role: writer, title: Write report, memory: { write_lessons: true }, approval: lead, extra: keep }
spawn_defaults:
  writer: { memory: { write_lessons: true }, expected_output: report, extra: keep }
  unknown: { memory: { write_lessons: true }, extra: leave-alone }`);
	if (!loaded.ok) throw new Error(loaded.error);
	return loaded.value;
};
type Control = {
	readonly children?: ReactNode;
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly onChange?: (event: { target: { checked: boolean } }) => void;
	readonly onClick?: () => void;
};
const controls = (node: ReactNode): ReactElement<Control>[] =>
	Children.toArray(node).flatMap((child) => {
		if (!isValidElement<Control>(child)) return [];
		if (typeof child.type === "function")
			return controls(
				(child.type as (props: unknown) => ReactNode)(child.props),
			);
		return child.type === "input" || child.type === "button"
			? [child]
			: controls(child.props.children);
	});
const form = (doc: Draft, busy = false, onEdit: OnEdit = vi.fn()) => {
	const onCommand = vi.fn();
	const view = TeamLearning({ team: teamOf(doc), busy, onEdit, onCommand });
	const nodes = controls(view);
	return {
		html: renderToStaticMarkup(view),
		checks: nodes.filter((node) => node.type === "input"),
		memory: required(nodes.find((node) => node.type === "button")),
		onCommand,
	};
};
const toggle = (input: ReactElement<Control>, checked: boolean) =>
	required(input.props.onChange)({ target: { checked } });

describe("task-scoped Learning (UX-L1)", () => {
	it("shows configured task/default states in a closed native disclosure, with the real cost and no outcome claim", () => {
		const doc = fixture();
		const onEdit = vi.fn();
		const view = form(doc, false, onEdit);
		expect(view.html).toContain("<summary>Learning</summary>");
		expect(view.html).not.toMatch(/<details[^>]*\bopen/);
		expect(view.html).toContain(
			"Plan work (Planner): write a lesson after approval",
		);
		expect(view.html).toContain(
			"Write report (Writer): write a lesson after approval",
		);
		expect(view.html).toContain("Generated-task defaults for Writer");
		expect(view.html).toContain(
			"One extra model request per approved task with lesson writing enabled.",
		);
		expect(view.checks.map((node) => node.props.checked)).toEqual([
			false,
			true,
			true,
		]);
		expect(view.html).not.toMatch(
			/Improve team|Train team|lessons learned|trained/,
		);
		expect(onEdit).not.toHaveBeenCalled();
		expect(view.onCommand).not.toHaveBeenCalled();
	});

	it.each([
		[0, true],
		[1, false],
	] as const)(
		"changes only task %i memory when checked=%s",
		(index, checked) => {
			const before = fixture();
			let doc = before;
			const onEdit = vi.fn<OnEdit>((path, value) => {
				doc = edited(doc, path, value);
			});
			toggle(required(form(doc, false, onEdit).checks[index]), checked);
			expect(onEdit).toHaveBeenCalledExactlyOnceWith(
				["tasks", index, "memory"],
				checked ? { write_lessons: true } : undefined,
			);
			expect(teamOf(doc).tasks[index]?.memory).toEqual(
				checked ? { write_lessons: true } : undefined,
			);
			expect(teamOf(doc).tasks[1 - index]).toEqual(
				teamOf(before).tasks[1 - index],
			);
			for (const key of ["title", "approval", "verify", "extra"])
				expect(doc.getIn(["tasks", index, key])).toEqual(
					before.getIn(["tasks", index, key]),
				);
			expect(doc.getIn(["spawn_defaults"])).toEqual(
				before.getIn(["spawn_defaults"]),
			);
			expect(doc.getIn(["roles"])).toEqual(before.getIn(["roles"]));
			expect(doc.toString()).toContain("# Keep this team note.");
		},
	);

	it.each([true, false])(
		"changes only an existing spawn default's memory when checked=%s",
		(checked) => {
			const before = edited(fixture(), ["spawn_defaults", "writer", "memory"], {
				write_lessons: !checked,
			});
			let doc = before;
			const onEdit = vi.fn<OnEdit>((path, value) => {
				doc = edited(doc, path, value);
			});
			toggle(required(form(doc, false, onEdit).checks[2]), checked);
			expect(onEdit).toHaveBeenCalledExactlyOnceWith(
				["spawn_defaults", "writer", "memory"],
				checked ? { write_lessons: true } : undefined,
			);
			expect(teamOf(doc).spawn_defaults.writer?.memory).toEqual(
				checked ? { write_lessons: true } : undefined,
			);
			expect(doc.getIn(["tasks"])).toEqual(before.getIn(["tasks"]));
			expect(doc.getIn(["spawn_defaults", "unknown"])).toEqual(
				before.getIn(["spawn_defaults", "unknown"]),
			);
			expect(doc.getIn(["spawn_defaults", "writer", "expected_output"])).toBe(
				"report",
			);
			expect(doc.getIn(["spawn_defaults", "writer", "extra"])).toBe("keep");
			expect(doc.getIn(["spawn_defaults", "spare"])).toBeUndefined();
		},
	);

	it("does not fabricate absent defaults or expose inactive defaults without a spawns task", () => {
		const doc = fixture();
		const onEdit = vi.fn();
		for (const next of [
			edited(doc, ["spawn_defaults"], undefined),
			edited(doc, ["tasks", 0, "spawns"], false),
		]) {
			const before = next.toString();
			const view = form(next, false, onEdit);
			expect(view.checks).toHaveLength(2);
			expect(view.html).not.toContain("Generated-task defaults");
			expect(next.toString()).toBe(before);
		}
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("keeps unknown-member work non-actionable and excludes orphan default keys", () => {
		const onEdit = vi.fn();
		const doc = edited(fixture(), ["tasks", 1, "role"], "missing");
		const view = form(doc, false, onEdit);
		const task = required(view.checks[1]);
		expect(task.props.checked).toBe(true);
		expect(task.props.disabled).toBe(true);
		toggle(task, false);
		expect(view.checks).toHaveLength(3);
		expect(view.html).not.toContain("Generated-task defaults for unknown");
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("disables native controls while busy and guards checkbox and Memory handlers", () => {
		const onEdit = vi.fn();
		const view = form(fixture(), true, onEdit);
		for (const input of view.checks) {
			expect(input.props.disabled).toBe(true);
			toggle(input, true);
			toggle(input, false);
		}
		expect(view.memory.props.disabled).toBe(true);
		required(view.memory.props.onClick)();
		expect(onEdit).not.toHaveBeenCalled();
		expect(view.onCommand).not.toHaveBeenCalled();
	});

	it("shows no lesson toggles for an empty team and opens existing Memory only on click", () => {
		const doc = edited(edited(fixture(), ["tasks"], []), ["roles"], []);
		const onEdit = vi.fn();
		const view = form(doc, false, onEdit);
		expect(view.checks).toHaveLength(0);
		expect(view.html).toContain("No tasks configured.");
		expect(view.onCommand).not.toHaveBeenCalled();
		expect(view.memory.props.disabled).toBe(false);
		required(view.memory.props.onClick)();
		expect(view.onCommand).toHaveBeenCalledExactlyOnceWith("mete.memory.open");
		expect(onEdit).not.toHaveBeenCalled();
	});
});
