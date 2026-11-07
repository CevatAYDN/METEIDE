import "reflect-metadata";
import { ok } from "@mete/contracts";
import type { CommandRegistry, MenuModelRegistry } from "@theia/core";
import { expect, it, vi } from "vitest";
import { contextScope } from "../src/application/context-drafts.js";
import {
	ADD_FILE_CONTEXT_COMMAND,
	ADD_SELECTION_COMMAND,
	MeteEditorContextContribution,
} from "../src/infrastructure/editor-context-contribution.js";
import { required } from "./required-fixture.js";

vi.mock("@theia/editor/lib/browser/editor-menu", () => ({
	EditorContextMenu: { COMMANDS: ["editor_context_menu", "commands"] },
}));
vi.mock("../src/infrastructure/editor-context-service.js", () => ({
	MeteEditorContext: class {},
}));
vi.mock("@theia/core/lib/browser/shell/application-shell", () => ({
	ApplicationShell: class {},
}));
vi.mock("../src/infrastructure/board-widget.js", () => ({
	MeteBoardWidget: { ID: "mete.board" },
}));
vi.mock("../src/infrastructure/board-contribution.js", () => ({
	MeteBoardContribution: class {},
}));
vi.mock("../src/infrastructure/focus-composer.js", () => ({
	focusComposer: vi.fn(),
}));
class Contribution extends MeteEditorContextContribution {
	constructor(deps: object) {
		super();
		Object.assign(this, deps);
	}
}

it("registers explicit palette/menu commands using the same capture path, with no startup read", async () => {
	const target = { dir: "/w", scope: contextScope("/w") };
	const capture = vi.fn((_mode: string) =>
		ok({ path: "/w/a.ts", content: "before focus", modified: true }),
	);
	const prepareCaptured = vi.fn(async () => true);
	const openView = vi.fn(async () => ({ node: {}, isVisible: true }));
	const contribution = new Contribution({
		context: {
			capture,
			prepareCaptured,
			canAttach: () => true,
			currentTarget: target,
			workspaceDir: "/w",
			drafts: { read: () => ({ busy: false }) },
		},
		board: { openView },
		messages: { warn: vi.fn() },
	});
	const registered: { id: string; execute?: (() => unknown) | undefined }[] =
		[];
	const commands = {
		registerCommand: (
			command: { id: string },
			handler: { execute?: () => unknown },
		) => {
			registered.push({ id: command.id, execute: handler.execute });
		},
	};
	contribution.registerCommands(
		commands as Pick<CommandRegistry, "registerCommand"> as CommandRegistry,
	);
	const menu = vi.fn<MenuModelRegistry["registerMenuAction"]>();
	contribution.registerMenus({ registerMenuAction: menu } as Pick<
		MenuModelRegistry,
		"registerMenuAction"
	> as MenuModelRegistry);
	expect(capture).not.toHaveBeenCalled();
	expect(registered.map((command) => command.id)).toEqual([
		ADD_SELECTION_COMMAND.id,
		ADD_FILE_CONTEXT_COMMAND.id,
	]);
	await required(required(registered[0]).execute)();
	await required(required(registered[1]).execute)();
	expect(capture.mock.calls.map(([mode]) => mode)).toEqual([
		"selection",
		"file",
	]);
	expect(openView.mock.calls).toEqual([
		[],
		[{ activate: true, reveal: true }],
		[],
		[{ activate: true, reveal: true }],
	]);
	expect(capture.mock.invocationCallOrder[0]).toBeLessThan(
		required(openView.mock.invocationCallOrder[0]),
	);
	expect(prepareCaptured.mock.invocationCallOrder[0]).toBeLessThan(
		required(openView.mock.invocationCallOrder[1]),
	);
	expect(menu.mock.calls.map(([, action]) => action.commandId)).toEqual([
		ADD_SELECTION_COMMAND.id,
		ADD_FILE_CONTEXT_COMMAND.id,
	]);
});

it("initializes a launch-time composer from captured text and never reveals a failed preparation", async () => {
	let target: { dir: string; scope: string } | undefined;
	let text = "captured selection";
	const showComposer = vi.fn(() => {
		target = { dir: "/w", scope: contextScope("/w") };
		text = "changed after navigation";
		return Promise.resolve();
	});
	const openView = vi.fn(async () => ({ showComposer }));
	const prepareCaptured = vi.fn(
		async (_scope: string, draft: { content: string }) => {
			expect(draft.content).toBe("captured selection");
			return false;
		},
	);
	const warn = vi.fn();
	const contribution = new Contribution({
		context: {
			get currentTarget() {
				return target;
			},
			workspaceDir: "/w",
			capture: () => ok({ path: "/w/a.ts", content: text, modified: true }),
			canAttach: () => true,
			prepareCaptured,
		},
		board: { openView },
		messages: { warn },
	});
	let execute: (() => unknown) | undefined;
	contribution.registerCommands({
		registerCommand: (_command, handler) => {
			if (!handler) throw new Error("command handler missing");
			execute ??= () => required(handler.execute)();
		},
	} as Pick<CommandRegistry, "registerCommand"> as CommandRegistry);
	await required(execute)();
	expect(showComposer).toHaveBeenCalledOnce();
	expect(prepareCaptured).toHaveBeenCalledOnce();
	expect(openView).toHaveBeenCalledOnce();
	expect(warn).toHaveBeenCalledOnce();
});
