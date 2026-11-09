import "reflect-metadata";
import {
	Children,
	cloneElement,
	createElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemberCard } from "../src/application/member-card.js";
import { draftOf } from "../src/application/team-draft.js";
import { MeteTeamEditorWidget } from "../src/infrastructure/team-editor-widget.js";
import { TeamPins } from "../src/infrastructure/team-pins.js";
import { required } from "./required-fixture.js";

vi.mock("../src/infrastructure/panel-widget.js", () => ({
	MetePanelWidget: class {
		update() {}
	},
}));
vi.mock("@theia/core", () => ({
	Command: { toLocalizedCommand: (command: object) => command },
	CommandService: class {},
	MessageService: class {},
}));
vi.mock("@theia/core/lib/browser/opener-service", () => ({
	OpenerService: class {},
	open: vi.fn(),
}));
vi.mock("@theia/core/lib/browser/theming", () => ({ ThemeService: class {} }));
vi.mock("@theia/core/lib/browser/widgets/widget", () => ({
	codicon: (name: string) => name,
}));
vi.mock("@theia/filesystem/lib/browser/file-service", () => ({
	FileService: class {},
}));
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class {},
}));

class TeamWidget extends MeteTeamEditorWidget {
	readonly command = vi.fn();
	constructor() {
		super();
		const loaded = draftOf(`metadata: { id: navigation, name: Navigation }
roles:
  - { id: lead, name: Lead, goal: Plan, tier: coder }
  - { id: writer, name: Writer, goal: Write, tier: coder }
tasks:
  - { id: plan, role: lead, title: Lead task }
  - { id: write, role: writer, title: Writer task }`);
		if (!loaded.ok) throw new Error(loaded.error);
		this.doc = loaded.value;
		this.pinned = new TeamPins({
			files: this.files,
			messages: this.messages,
			daemon: this.daemon,
		});
		Object.assign(this, {
			themes: { getCurrentTheme: () => ({ type: "light" }) },
			commands: { executeCommand: this.command },
		});
		this.model = this.readyOf("workspace", false);
	}
	screen() {
		return this.render();
	}
	state() {
		return this.model;
	}
	yaml() {
		return required(this.doc).toString();
	}
	legacy() {
		if (this.model.kind !== "ready") throw new Error("Missing ready model");
		const { memberSection: _section, ...model } = this.model;
		this.model = model;
	}
}

type Props = {
	readonly children?: ReactNode;
	readonly className?: string;
	readonly role?: string;
	readonly id?: string;
	readonly hidden?: boolean;
	readonly value?: string;
	readonly "data-member-section"?: string;
	readonly onClick?: () => void;
	readonly onChange?: (event: { target: { value: string } }) => void;
};

// Inspect real components inside SSR's hook context; only Theia's host shell is replaced.
const inspect = (widget: TeamWidget) => {
	const nodes: ReactElement<Props>[] = [];
	let card: ReactElement<Props> | undefined;
	const visit = (node: ReactNode): ReactNode =>
		Children.map(node, (child) => {
			if (!isValidElement<Props>(child)) return child;
			if (child.type === MemberCard) card = child;
			if (typeof child.type === "function") {
				const Component = child.type as (props: unknown) => ReactNode;
				return createElement(() => visit(Component(child.props)), {
					key: child.key,
				});
			}
			nodes.push(child);
			return cloneElement(child, undefined, visit(child.props.children));
		});
	const html = renderToStaticMarkup(
		createElement(() => visit(widget.screen())),
	);
	const panel = (section: string) =>
		required(
			nodes.find(
				(node) =>
					node.props.role === "tabpanel" &&
					node.props.id?.endsWith(`-${section}-panel`),
			),
		);
	const tab = (section: string) =>
		required(
			nodes.find((node) => node.props["data-member-section"] === section),
		);
	const button = (text: string, className?: string) =>
		required(
			nodes.find(
				(node) =>
					node.type === "button" &&
					(!className || node.props.className === className) &&
					renderToStaticMarkup(node).includes(text),
			),
		);
	return { html, nodes, card: required(card), panel, tab, button };
};
const click = (node: ReactElement<Props>) => required(node.props.onClick)();

describe("Order of work navigation (U2-R1)", () => {
	it.each([
		[0, "Lead task"],
		[1, "Writer task"],
	] as const)(
		"opens Tasks for member %i through its actual task-row callback",
		(index, title) => {
			const widget = new TeamWidget();
			const before = widget.yaml();
			click(inspect(widget).button(title, "mete-order-step"));
			const view = inspect(widget);
			expect(widget.state()).toMatchObject({
				selected: index,
				memberSection: "tasks",
			});
			expect(view.panel("tasks").props.hidden).toBe(false);
			expect(view.panel("member").props.hidden).toBe(true);
			expect(view.html).toContain(`value="${title}"`);
			expect(widget.yaml()).toBe(before);
			// Returning to Member must not prevent a same-member task click from reopening Tasks.
			click(view.tab("member"));
			expect(inspect(widget).panel("member").props.hidden).toBe(false);
			click(inspect(widget).button(title, "mete-order-step"));
			expect(inspect(widget).panel("tasks").props.hidden).toBe(false);
		},
	);

	it("updates controlled tab selection without resetting the member or panel keys or edited fields", () => {
		const widget = new TeamWidget();
		const initial = inspect(widget);
		const goal = required(
			initial.nodes.find(
				(node) => node.type === "textarea" && node.props.value === "Plan",
			),
		);
		required(goal.props.onChange)({ target: { value: "Half-written goal" } });
		const before = widget.yaml();
		for (const section of ["tasks", "member", "tasks"]) {
			click(inspect(widget).tab(section));
			const view = inspect(widget);
			expect(widget.state()).toMatchObject({
				selected: 0,
				memberSection: section,
			});
			expect(view.panel(section).props.hidden).toBe(false);
			expect(view.card.key).toBe(initial.card.key);
			for (const name of ["member", "tasks"])
				expect(view.panel(name).key).toBe(initial.panel(name).key);
			expect(view.html).toContain("Half-written goal");
			expect(widget.yaml()).toBe(before);
		}
		click(inspect(widget).button("Writer task", "mete-order-step"));
		click(inspect(widget).button("Lead task", "mete-order-step"));
		expect(inspect(widget).html).toContain("Half-written goal");
		expect(widget.yaml()).toBe(before);
	});

	it("lets roster selection return to Member and retains the selected task target on edits", () => {
		const widget = new TeamWidget();
		click(inspect(widget).button("Writer task", "mete-order-step"));
		click(inspect(widget).button("Add a task for this member"));
		expect(widget.state()).toMatchObject({
			selected: 1,
			memberSection: "tasks",
			team: {
				tasks: [{ role: "lead" }, { role: "writer" }, { role: "writer" }],
			},
		});
		click(inspect(widget).button("Lead", "mete-member-tile"));
		expect(widget.state()).toMatchObject({
			selected: 0,
			memberSection: "member",
		});
		expect(inspect(widget).panel("member").props.hidden).toBe(false);
	});

	it("defaults legacy model fixtures to Member and preserves main's workspace commands", () => {
		const widget = new TeamWidget();
		widget.legacy();
		const view = inspect(widget);
		expect(view.panel("member").props.hidden).toBe(false);
		expect(view.panel("tasks").props.hidden).toBe(true);
		const before = widget.yaml();
		click(view.button(">Skills<"));
		expect(widget.command).toHaveBeenCalledOnce();
		expect(widget.yaml()).toBe(before);
	});
});
