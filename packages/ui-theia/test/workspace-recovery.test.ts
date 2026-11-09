import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	Children,
	createElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComposerView } from "../src/application/composer-view.js";
import { SettingsView } from "../src/application/settings-view.js";
import type { WelcomeModel } from "../src/application/welcome-view.js";
import { WelcomeView } from "../src/application/welcome-view.js";
import { required } from "./required-fixture.js";

type Button = {
	readonly children?: ReactNode;
	readonly type?: string;
	readonly disabled?: boolean;
	readonly tabIndex?: number;
	readonly onClick?: () => void;
};

// Expand stateless recovery views to exercise the callbacks of the rendered native buttons.
const buttons = (node: ReactNode): ReactElement<Button>[] =>
	Children.toArray(node).flatMap((child) => {
		if (!isValidElement<Button>(child)) return [];
		if (typeof child.type === "function")
			return buttons(
				(child.type as (props: unknown) => ReactNode)(child.props),
			);
		return child.type === "button" ? [child] : buttons(child.props.children);
	});

const buttonNamed = (view: ReactNode, name: string) =>
	required(
		buttons(view).find((button) => renderToStaticMarkup(button).includes(name)),
	);

const activate = (button: ReactElement<Button>) => {
	expect(button.props.type).toBe("button");
	expect(button.props.tabIndex).not.toBe(-1);
	expect(button.props.disabled).not.toBe(true);
	required(button.props.onClick)();
};

describe("no-workspace recovery", () => {
	it.each(["composer", "settings"])(
		"keeps the %s recovery button at its intrinsic width",
		(view) => {
			const css = readFileSync(
				join(__dirname, "..", "style", `mete-${view}.css`),
				"utf8",
			);
			expect(css).toMatch(
				new RegExp(
					`\\.mete-${view} > \\.mete-button\\s*\\{[^}]*align-self: flex-start;`,
				),
			);
		},
	);
	it("opens a folder from the rendered composer without offering a folderless input", () => {
		const onOpenFolder = vi.fn();
		const onStart = vi.fn();
		const view = createElement(ComposerView, {
			model: { kind: "no_folder" },
			goal: "",
			selected: "single",
			busy: false,
			onGoal: vi.fn(),
			onSelect: vi.fn(),
			onStart,
			onEdit: vi.fn(),
			onNewTeam: vi.fn(),
			onOpenFolder,
		});
		expect(renderToStaticMarkup(view)).not.toContain("<textarea");
		activate(buttonNamed(view, "Open folder"));
		expect(onOpenFolder).toHaveBeenCalledOnce();
		expect(onStart).not.toHaveBeenCalled();
	});
	it("opens Theia's folder picker from Settings and retains Refresh", () => {
		const onCommand = vi.fn();
		const onRefresh = vi.fn();
		const view = createElement(SettingsView, {
			model: { kind: "no_folder" },
			actions: {
				onApply: vi.fn(),
				onCommand,
				onOpen: vi.fn(),
				onRefresh,
				onScope: vi.fn(),
				onSaveAll: vi.fn(),
			},
		});
		activate(buttonNamed(view, "Open folder"));
		expect(onCommand).toHaveBeenCalledExactlyOnceWith("workspace:openFolder");
		activate(buttonNamed(view, "Refresh"));
		expect(onRefresh).toHaveBeenCalledOnce();
		expect(renderToStaticMarkup(view)).not.toContain("Save changes");
	});
});

const welcome = (
	workspaceOpen: boolean,
	model: WelcomeModel,
	onStart = vi.fn(),
) =>
	createElement(WelcomeView, {
		model,
		workspaceOpen,
		keys: {
			stateOf: () => ({ key: "", busy: false }),
			onType: vi.fn(),
			onSet: vi.fn(),
			activeRuns: 0,
		},
		actions: {
			onLanguage: vi.fn(),
			onKeyPage: vi.fn(),
			onStart,
			onCheck: vi.fn(),
			onSettings: vi.fn(),
		},
	});
const savedKey: WelcomeModel = {
	kind: "keys",
	keys: [
		{
			id: "nvidia",
			kind: "model",
			set: true,
			keyPage: "https://example.test/keys",
		},
	],
};

describe("Welcome continuation readiness", () => {
	it("keeps Start disabled with a saved key but no workspace and names the missing folder", () => {
		const onStart = vi.fn();
		const view = welcome(false, savedKey, onStart);
		const start = buttonNamed(view, "Start a run");
		expect(start.props.disabled).toBe(true);
		expect(renderToStaticMarkup(view)).toContain("Open a folder first");
		required(start.props.onClick)();
		expect(onStart).not.toHaveBeenCalled();
	});
	it("continues when both are ready and stops after the current workspace is removed", () => {
		const onStart = vi.fn();
		activate(buttonNamed(welcome(true, savedKey, onStart), "Start a run"));
		expect(onStart).toHaveBeenCalledOnce();
		const removed = buttonNamed(
			welcome(false, savedKey, onStart),
			"Start a run",
		);
		expect(removed.props.disabled).toBe(true);
		required(removed.props.onClick)();
		expect(onStart).toHaveBeenCalledOnce();
	});
	it("does not substitute a search key for the existing model-key requirement", () => {
		const view = welcome(true, {
			kind: "keys",
			keys: [
				{
					id: "tavily",
					kind: "search",
					set: true,
					keyPage: "https://example.test/keys",
				},
			],
		});
		expect(buttonNamed(view, "Start a run").props.disabled).toBe(true);
		expect(renderToStaticMarkup(view)).toContain(
			"Set a model provider&#x27;s key first.",
		);
	});
	it.each<WelcomeModel>([
		{ kind: "loading" },
		{
			kind: "failed",
			failure: { code: "cli", detail: "keychain unavailable" },
		},
	])("offers no continuation for $kind key readiness", (model) => {
		expect(renderToStaticMarkup(welcome(true, model))).not.toContain(
			"Start a run",
		);
	});
});
