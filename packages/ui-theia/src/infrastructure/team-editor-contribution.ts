import { Command, type CommandRegistry, MessageService } from "@theia/core";
import {
	AbstractViewContribution,
	bindViewContribution,
	WidgetFactory,
} from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { QuickInputService } from "@theia/core/lib/common/quick-pick-service";
import {
	inject,
	injectable,
	type interfaces,
} from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import {
	failureText,
	noFolderText,
	plain,
} from "../application/status-text.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { MeteTeamEditorWidget } from "./team-editor-widget.js";

// The team editor's place in Theia (ADR-075): "METE: Edit team" opens it in the main area for a team
// picked from mete/templates, or for the id the run composer's Edit button passes.

/** The palette entry "METE: Edit team". */
export const EDIT_TEAM_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.team.edit", category: "METE", label: "Edit team" },
	"mete/team/edit",
	"mete/category",
);

@injectable()
export class MeteTeamEditorContribution extends AbstractViewContribution<MeteTeamEditorWidget> {
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(QuickInputService) protected readonly quick!: QuickInputService;
	@inject(MessageService) protected readonly messages!: MessageService;

	constructor() {
		super({
			widgetId: MeteTeamEditorWidget.ID,
			widgetName: nls.localize("mete/team/title", "Edit team"),
			defaultWidgetOptions: { area: "main" },
		});
	}

	override registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(EDIT_TEAM_COMMAND, {
			execute: async (given?: unknown) => {
				const id = await this.teamOf(given);
				if (!id) return;
				const widget = await this.openView({ activate: true, reveal: true });
				await widget.load(id);
			},
		});
	}

	// The team the composer passed, or one picked among the folder's templates.
	protected async teamOf(given: unknown): Promise<string | undefined> {
		if (typeof given === "string" && given) return given;
		const root = this.workspace.tryGetRoots()[0];
		if (!root) return void this.messages.info(noFolderText());
		const listed = await this.daemon.templates(root.resource.path.fsPath());
		if (!listed.ok)
			return void this.messages.warn(failureText(listed.error, plain));
		const pick = await this.quick.pick(
			listed.value.templates.map((t) => ({
				label: t.name,
				description: t.id,
				id: t.id,
			})),
			{
				placeHolder: nls.localize("mete/team/which", "Which team?"),
			},
		);
		return pick?.id;
	}
}

/** Binds the team editor, its factory and its contribution into the frontend container. */
export const bindTeamEditor = (bind: interfaces.Bind) => {
	bindViewContribution(bind, MeteTeamEditorContribution);
	bind(MeteTeamEditorWidget).toSelf();
	bind(WidgetFactory)
		.toDynamicValue((ctx) => ({
			id: MeteTeamEditorWidget.ID,
			createWidget: () => ctx.container.get(MeteTeamEditorWidget),
		}))
		.inSingletonScope();
};
