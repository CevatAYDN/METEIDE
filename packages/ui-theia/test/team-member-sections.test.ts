import {
	Children,
	type ComponentProps,
	createElement,
	isValidElement,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemberCard } from "../src/application/member-card.js";
import { MemberSections } from "../src/application/member-sections.js";
import { draftOf, teamOf } from "../src/application/team-draft.js";

type Section = ComponentProps<typeof MemberSections>["selected"];
type Tab = {
	readonly onClick: () => void;
	readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};
const member = createElement("input", { defaultValue: "half-typed member" });
const tasks = createElement("input", { defaultValue: "half-typed task" });
const view = (
	selected: Section,
	onSelect: (section: Section) => void = vi.fn(),
) =>
	MemberSections({ id: "selected-member", selected, onSelect, member, tasks });
const tab = (
	selected: Section,
	index: number,
	onSelect: (section: Section) => void,
) => {
	const list = Children.toArray(view(selected, onSelect).props.children)[0];
	if (!isValidElement<{ children: ReactNode }>(list))
		throw new Error("Missing tablist");
	const button = Children.toArray(list.props.children)[index];
	if (!isValidElement<Tab>(button) || button.type !== "button")
		throw new Error("Missing native tab");
	return button.props;
};

const expectRetainedPanel = (
	panel: ReactNode,
	index: number,
	selected: Section,
) => {
	if (!isValidElement<{ children: ReactNode; hidden: boolean }>(panel))
		throw new Error("Missing panel");
	expect(panel.props.children).toBe(index === 0 ? member : tasks);
	expect(panel.props.hidden).toBe(
		(index === 0 ? "member" : "tasks") !== selected,
	);
};

describe("selected member sections (UX-U2a, ADR-192)", () => {
	it.each(["member", "tasks"] as const)(
		"retains both panels and their children when %s is selected",
		(selected) => {
			const tree = view(selected);
			const panels = Children.toArray(tree.props.children).slice(1);
			expect(panels).toHaveLength(2);
			for (const [index, panel] of panels.entries())
				expectRetainedPanel(panel, index, selected);
			const html = renderToStaticMarkup(tree);
			expect(html).toContain('value="half-typed member"');
			expect(html).toContain('value="half-typed task"');
			expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
			expect(html.match(/hidden=""/g)).toHaveLength(1);
			expect(html).toContain('role="tablist" aria-label="Member sections"');
			for (const section of ["member", "tasks"]) {
				const active = section === selected;
				expect(html).toContain(
					`id="selected-member-${section}-tab" role="tab" aria-controls="selected-member-${section}-panel" aria-selected="${active}" tabindex="${active ? 0 : -1}"`,
				);
				expect(html).toContain(
					`id="selected-member-${section}-panel" role="tabpanel" aria-labelledby="selected-member-${section}-tab"`,
				);
			}
			expect(html).toContain(">Member</button>");
			expect(html).toContain(">Tasks</button>");
		},
	);

	it("selects either native tab on click without invoking form actions", () => {
		const onSelect = vi.fn();
		tab("member", 1, onSelect).onClick();
		expect(onSelect).toHaveBeenLastCalledWith("tasks");
		tab("tasks", 0, onSelect).onClick();
		expect(onSelect).toHaveBeenLastCalledWith("member");
		expect(onSelect).toHaveBeenCalledTimes(2);
	});

	it.each([
		["member", "ArrowRight", "tasks"],
		["member", "ArrowLeft", "tasks"],
		["tasks", "ArrowRight", "member"],
		["tasks", "ArrowLeft", "member"],
		["tasks", "Home", "member"],
		["member", "End", "tasks"],
		["member", "Home", "member"],
		["tasks", "End", "tasks"],
	] as const)(
		"moves selection and focus from %s with %s to %s",
		(selected, key, next) => {
			const onSelect = vi.fn();
			const focus = vi.fn();
			const querySelector = vi.fn(() => ({ focus }));
			const preventDefault = vi.fn();
			const stopPropagation = vi.fn();
			tab(selected, selected === "member" ? 0 : 1, onSelect).onKeyDown({
				key,
				preventDefault,
				stopPropagation,
				currentTarget: { parentElement: { querySelector } },
			} as unknown as KeyboardEvent<HTMLButtonElement>);
			expect(onSelect).toHaveBeenCalledExactlyOnceWith(next);
			expect(querySelector).toHaveBeenCalledWith(
				`[data-member-section="${next}"]`,
			);
			expect(focus).toHaveBeenCalledOnce();
			expect(preventDefault).toHaveBeenCalledOnce();
			expect(stopPropagation).toHaveBeenCalledOnce();
		},
	);

	it("leaves Tab and unrelated keys to native button behavior", () => {
		const onSelect = vi.fn();
		for (const key of ["Tab", "Enter", " ", "ArrowDown", "Escape"]) {
			const preventDefault = vi.fn();
			tab("member", 0, onSelect).onKeyDown({
				key,
				preventDefault,
			} as unknown as KeyboardEvent<HTMLButtonElement>);
			expect(preventDefault).not.toHaveBeenCalled();
		}
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("keeps existing member values, inactive fields and task lessons in their respective panels without edits", () => {
		const loaded = draftOf(`roles:
  - { id: writer, name: Writer, goal: Write, tier: coder, capabilities: [fs.read@1], watches: [gdd@1], prefer_different_family_than: [reviewer] }
tasks:
  - { id: write, role: writer, title: Write report, memory: { write_lessons: true } }`);
		if (!loaded.ok) throw new Error(loaded.error);
		const onEdit = vi.fn();
		const none = vi.fn();
		const before = loaded.value.toString();
		const html = renderToStaticMarkup(
			createElement(MemberCard, {
				team: teamOf(loaded.value),
				index: 0,
				fixed: true,
				hints: [],
				outputs: [],
				pin: { models: [] },
				draft: { busy: false, filled: "none", sources: [] },
				onEdit,
				onRename: none,
				onPin: none,
				onRemove: none,
				onAddTask: none,
				onRemoveTask: none,
				onDraft: none,
			}),
		);
		const [memberPanel = "", taskPanel = ""] = html
			.split('role="tabpanel"')
			.slice(1);
		expect(memberPanel).toContain('value="Writer"');
		expect(memberPanel).toContain(">fs.read@1<");
		const advanced =
			memberPanel.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
		expect(advanced).toContain("<summary>Advanced</summary>");
		expect(advanced).not.toMatch(/<details[^>]*\bopen/);
		expect(advanced).toMatch(/disabled="" value="gdd@1"/);
		expect(advanced).toMatch(/disabled="" value="reviewer"/);
		expect(taskPanel).toContain('value="Write report"');
		expect(taskPanel).toContain(
			'<input type="checkbox" checked=""/>Writes a lesson to the vault after approval',
		);
		expect(memberPanel).not.toContain("Writes a lesson");
		expect(onEdit).not.toHaveBeenCalled();
		expect(none).not.toHaveBeenCalled();
		expect(loaded.value.toString()).toBe(before);
	});
});
