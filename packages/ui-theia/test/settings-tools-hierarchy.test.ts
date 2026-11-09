import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GroupList } from "../src/application/settings-frame.js";
import { groupsOf } from "../src/application/settings-groups.js";
import { SettingsView } from "../src/application/settings-view.js";
import { required } from "./required-fixture.js";

type NativeControl = {
	readonly children?: ReactNode;
	readonly onClick?: () => void;
};
const GROUP_IDS = [
	"models",
	"limits",
	"privacy",
	"tools",
	"skills",
	"teams",
	"look",
	"other",
];

const buttons = (node: ReactNode): ReactNode[] =>
	Children.toArray(node).flatMap((child) => {
		if (!isValidElement<NativeControl>(child)) return [];
		if (typeof child.type === "function")
			return buttons(
				(child.type as (props: unknown) => ReactNode)(child.props),
			);
		return child.type === "button" ? [child] : buttons(child.props.children);
	});

describe("Tools settings hierarchy (ADR-180)", () => {
	it("leads with MCP and Add server, keeping bindings in collapsed Advanced without writing", () => {
		const onAdd = vi.fn();
		const onSaveAll = vi.fn();
		const out = renderToStaticMarkup(
			createElement(SettingsView, {
				model: {
					kind: "settings",
					settings: {
						loadedAt: "2026-11-08T10:00:00.000Z",
						sections: [],
					},
				},
				actions: {
					onApply: vi.fn(),
					onCommand: vi.fn(),
					onOpen: vi.fn(),
					onRefresh: vi.fn(),
					onScope: vi.fn(),
					onSaveAll,
				},
				choice: { group: "tools", onGroup: vi.fn() },
				mcp: {
					state: {
						target: "workspace",
						servers: [],
						busy: false,
						dirty: false,
					},
					actions: {
						onField: vi.fn(),
						onPermission: vi.fn(),
						onAdd,
						onRemove: vi.fn(),
					},
				},
				bindings: {
					state: {
						target: "workspace",
						rows: [
							{ capability: "web.search@1", adapters: "adapter-a, adapter-b" },
						],
						busy: false,
						dirty: true,
					},
					actions: { onRow: vi.fn(), onAdd, onRemove: vi.fn() },
				},
			}),
		);
		const mcp = out.indexOf('aria-label="MCP servers"');
		const add = out.indexOf("Add server");
		const advanced = out.indexOf('<details class="mete-settings-advanced">');
		expect(mcp).toBeGreaterThan(0);
		expect(add).toBeGreaterThan(mcp);
		expect(advanced).toBeGreaterThan(add);
		const disclosure = out.slice(
			advanced,
			out.indexOf('aria-label="Which shell"'),
		);
		expect(disclosure).toContain("<summary>Advanced</summary>");
		expect(disclosure).not.toMatch(/<details[^>]* open/);
		expect(disclosure).toContain('aria-label="Tool adapters"');
		expect(disclosure).toContain('value="adapter-a, adapter-b"');
		expect(disclosure).toContain("Add capability");
		expect(out).toContain("Unsaved changes: bindings");
		expect(onAdd).not.toHaveBeenCalled();
		expect(onSaveAll).not.toHaveBeenCalled();
	});

	it("retains every named category and its selection callback in compact navigation", () => {
		const onGroup = vi.fn();
		const groups = groupsOf([{ name: "extra-file", merged: undefined }]);
		expect(groups.map(({ id }) => id)).toEqual(GROUP_IDS);
		const nav = createElement(GroupList, {
			groups,
			chosen: required(groups.find((group) => group.id === "tools")),
			onGroup,
		});
		const controls = buttons(nav);
		expect(controls).toHaveLength(8);
		for (const group of groups) {
			const control = required(
				controls.find((button) =>
					renderToStaticMarkup(button).includes(group.label),
				),
			);
			if (!isValidElement<NativeControl>(control))
				throw new Error("Category did not render a native button");
			required(control.props.onClick)();
			expect(onGroup).toHaveBeenLastCalledWith(group.id);
		}
		expect(renderToStaticMarkup(nav)).toContain('aria-label="Settings groups"');
		expect(
			renderToStaticMarkup(nav).match(/aria-pressed="true"/g),
		).toHaveLength(1);
	});

	it("offers every category in a named native selector with the current choice and callback", () => {
		const onGroup = vi.fn();
		const groups = groupsOf([{ name: "extra-file", merged: undefined }]);
		expect(groups.map(({ id }) => id)).toEqual(GROUP_IDS);
		const nav = GroupList({
			groups,
			chosen: required(groups.find((group) => group.id === "tools")),
			onGroup,
		});
		const select = required(
			Children.toArray(nav.props.children).find(
				(child) => isValidElement(child) && child.type === "select",
			),
		);
		if (
			!isValidElement<{
				value: string;
				onChange: (event: { currentTarget: { value: string } }) => void;
			}>(select)
		)
			throw new Error("Category selector was not rendered");
		const out = renderToStaticMarkup(select);
		expect(out).toContain('aria-label="Settings groups"');
		expect(out.match(/<option /g)).toHaveLength(8);
		expect(select.props.value).toBe("tools");
		for (const group of groups) {
			expect(out).toContain(`value="${group.id}"`);
			expect(out).toContain(`>${group.label}</option>`);
			select.props.onChange({ currentTarget: { value: group.id } });
			expect(onGroup).toHaveBeenLastCalledWith(group.id);
		}
	});

	it("exchanges the full navigation for one native selector in narrow panels", () => {
		// A source layout guard, not proof of Electron viewport bounds.
		const css = readFileSync(
			join(__dirname, "..", "style", "mete-settings.css"),
			"utf8",
		);
		const breakpoint = css.indexOf("@container (max-width: 600px)");
		const end = css.indexOf("\n}\n", breakpoint);
		expect(breakpoint).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(breakpoint);
		const wide = css.slice(0, breakpoint);
		const narrow = css.slice(breakpoint, end + 2);
		expect(wide).toMatch(/\.mete-settings-category\s*\{\s*display: none;/);
		expect(narrow).toMatch(
			/\.mete-settings-category\s*\{[^}]*display: block;[^}]*width: 100%;/,
		);
		expect(narrow).toMatch(/\.mete-settings-group\s*\{\s*display: none;/);
		expect(narrow).not.toMatch(/font-size:|text-overflow:|line-clamp:/);
	});
});
