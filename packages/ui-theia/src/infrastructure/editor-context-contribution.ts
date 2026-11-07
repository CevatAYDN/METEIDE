import {
	Command,
	type CommandContribution,
	type CommandRegistry,
	type MenuContribution,
	type MenuModelRegistry,
	MessageService,
} from "@theia/core";
import { inject, injectable } from "@theia/core/shared/inversify";
import { EditorContextMenu } from "@theia/editor/lib/browser/editor-menu";
import type { ContextTarget } from "../application/context-drafts.js";
import { runEditorContextCommand } from "../application/editor-context-command.js";
import { MeteBoardContribution } from "./board-contribution.js";
import type { MeteBoardWidget } from "./board-widget.js";
import { MeteEditorContext } from "./editor-context-service.js";
import { focusComposer } from "./focus-composer.js";

/** Explicit selection attachment command; never saves or sends the buffer. */
export const ADD_SELECTION_COMMAND = Command.toLocalizedCommand(
	{
		id: "mete.context.selection",
		category: "METE",
		label: "Add selection",
	},
	"mete/context/selection",
	"mete/category",
);
/** Explicit whole open-file attachment command. */
export const ADD_FILE_CONTEXT_COMMAND = Command.toLocalizedCommand(
	{
		id: "mete.context.file",
		category: "METE",
		label: "Add open file",
	},
	"mete/context/file",
	"mete/category",
);

/** Native editor context menu and command palette entries share the exact capture path. */
@injectable()
export class MeteEditorContextContribution
	implements CommandContribution, MenuContribution
{
	@inject(MeteEditorContext) protected readonly context!: MeteEditorContext;
	@inject(MeteBoardContribution)
	protected readonly board!: MeteBoardContribution;
	@inject(MessageService) protected readonly messages!: MessageService;
	private async add(mode: "file" | "selection"): Promise<void> {
		if (!this.context.canAttach()) return;
		let widget: MeteBoardWidget | undefined;
		await runEditorContextCommand(
			{
				capture: (choice) => this.context.capture(choice),
				dir: () => this.context.workspaceDir,
				target: () => this.context.currentTarget,
				open: async () => {
					widget = await this.board.openView();
				},
				initial: () => widget?.showComposer() ?? Promise.resolve(),
				prepare: (scope, draft) => this.context.prepareCaptured(scope, draft),
				reveal: (target) => this.reveal(target),
				warn: (message) => {
					void this.messages.warn(message);
				},
			},
			mode,
		);
	}
	private async reveal(target: ContextTarget): Promise<void> {
		if (this.context.currentTarget !== target) return;
		const widget = await this.board.openView({ activate: true, reveal: true });
		focusComposer(
			{
				node: widget.node,
				ready: () =>
					this.context.currentTarget === target &&
					this.context.workspaceDir === target.dir &&
					!this.context.drafts.read(target.scope).busy,
				visible: () => widget.isVisible,
			},
			() => {},
		);
	}
	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(ADD_SELECTION_COMMAND, {
			execute: () => this.add("selection"),
			isEnabled: () => this.context.canAttach(),
		});
		commands.registerCommand(ADD_FILE_CONTEXT_COMMAND, {
			execute: () => this.add("file"),
			isEnabled: () => this.context.canAttach(),
		});
	}
	registerMenus(menus: MenuModelRegistry): void {
		for (const command of [ADD_SELECTION_COMMAND, ADD_FILE_CONTEXT_COMMAND])
			menus.registerMenuAction(EditorContextMenu.COMMANDS, {
				commandId: command.id,
			});
	}
}
