import { applyAll, EMPTY_TEAM_VIEW } from "@mete/ui-studio";
import {
	Command,
	type CommandContribution,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { nls } from "@theia/core/lib/common/nls";
import { QuickInputService } from "@theia/core/lib/common/quick-pick-service";
import { inject, injectable } from "@theia/core/shared/inversify";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { artifactToOpen, worktreeTaskOf } from "../application/artifact.js";
import {
	failureText,
	noFolderText,
	plain,
} from "../application/status-text.js";
import { MeteDaemonService } from "../domain/status-service.js";
import { showWorktreeFiles } from "./worktree-files.js";

// "METE: Open artifact" (docs/13, Approvals inbox: artifact preview): it reads the run's history,
// finds the report under review and opens it in an editor, or with no report lists the files of the
// task that waits for the human (ADR-133). The inbox's button passes the run; from the palette it
// asks which one.

/** The palette entry "METE: Open artifact". */
export const OPEN_ARTIFACT_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.run.openArtifact", category: "METE", label: "Open artifact" },
	"mete/run/openArtifact",
	"mete/category",
);

@injectable()
export class MeteArtifactContribution implements CommandContribution {
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(OpenerService) protected readonly openers!: OpenerService;
	@inject(QuickInputService) protected readonly quick!: QuickInputService;
	@inject(FileService) protected readonly files!: FileService;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(OPEN_ARTIFACT_COMMAND, {
			execute: (runId?: unknown) => this.openArtifact(runId),
		});
	}

	// The run the inbox passed, or one picked among the folder's runs, newest first.
	protected async runOf(
		dir: string,
		given: unknown,
	): Promise<string | undefined> {
		if (typeof given === "string" && given) return given;
		const runs = await this.daemon.status(dir);
		if (!runs.ok)
			return void this.messages.warn(failureText(runs.error, plain));
		const pick = await this.quick.pick(
			runs.value.map((r) => ({
				label: r.goal,
				description: r.status,
				runId: r.id,
			})),
			{ placeHolder: nls.localize("mete/run/which", "Which run?") },
		);
		return pick?.runId;
	}

	protected async openArtifact(given: unknown): Promise<void> {
		const root = this.workspace.tryGetRoots()[0];
		if (!root) return void this.messages.info(noFolderText());
		const runId = await this.runOf(root.resource.path.fsPath(), given);
		if (!runId) return;
		const r = await this.daemon.events(root.resource.path.fsPath(), runId);
		if (!r.ok) return void this.messages.warn(failureText(r.error, plain));
		const view = applyAll(runId, EMPTY_TEAM_VIEW, r.value.events);
		const path = artifactToOpen(view);
		// No report: the files of the task that waits for the human, as its card's Show files (ADR-133).
		const task = path ? undefined : worktreeTaskOf(view);
		if (task?.worktree) {
			const { files, quick, openers, messages } = this;
			const deps = { files, quick, openers, messages };
			return showWorktreeFiles(deps, task.worktree, task.files);
		}
		if (!path)
			return void this.messages.info(
				nls.localize(
					"mete/run/noArtifact",
					"This run has no report to open yet.",
				),
			);
		await open(this.openers, root.resource.resolve(path));
	}
}
