import type { RunStart } from "@mete/contracts";
import {
	Command,
	type CommandContribution,
	type CommandRegistry,
	MessageService,
} from "@theia/core";
import { nls } from "@theia/core/lib/common/nls";
import {
	QuickInputService,
	type QuickPickItem,
} from "@theia/core/lib/common/quick-pick-service";
import { inject, injectable } from "@theia/core/shared/inversify";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { MeteDaemonService } from "../domain/status-service.js";
import { failureText, noFolderText, plain } from "./status-text.js";

// The run composer (ADR-047, ADR-058): a goal, then "Let METE choose", a template or a single agent;
// the router asks for a team when it is unsure.
// shortcut: the request estimate and the autonomy level of docs/13 come when the daemon offers them.

/** The palette entry "METE: Start run". */
export const START_RUN_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.run.start", category: "METE", label: "Start run" },
	"mete/run/start",
	"mete/category",
);

type TeamPick = QuickPickItem & { readonly templateId: string | null };

// The composer's list: undefined lets the router choose.
type StartPick = QuickPickItem & { readonly templateId?: string | null };

@injectable()
export class MeteStartRunContribution implements CommandContribution {
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(QuickInputService) protected readonly quick!: QuickInputService;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(START_RUN_COMMAND, {
			execute: () => this.start(),
		});
	}

	protected async start(): Promise<void> {
		const root = this.workspace.tryGetRoots()[0];
		if (!root) return void this.messages.info(noFolderText());
		const goal = (
			await this.quick.input({
				prompt: nls.localize(
					"mete/run/goal",
					"What should METE do in this folder?",
				),
				ignoreFocusLost: true,
			})
		)?.trim();
		if (!goal) return;
		const dir = root.resource.path.fsPath();
		const chosen = await this.pickStart(dir);
		if (!chosen) return;
		if (chosen.templateId !== undefined)
			return this.report(
				await this.starting(dir, { goal, templateId: chosen.templateId }),
			);
		let r = await this.starting(dir, { goal });
		if (!r.ok && r.error.code === "choose_template") {
			const team = await this.pickTeam(r.error.suggestions ?? []);
			if (!team) return;
			const req: RunStart = { goal, templateId: team.templateId };
			r = await this.starting(dir, req);
		}
		this.report(r);
	}

	protected report(r: Awaited<ReturnType<MeteDaemonService["startRun"]>>) {
		if (r.ok)
			void this.messages.info(
				nls.localize("mete/run/started", "Run started: {0}", r.value.runId),
			);
		else void this.messages.warn(failureText(r.error, plain));
	}

	// "Let METE choose", the folder's templates, a single agent (ADR-058); without the list, the router.
	protected async pickStart(dir: string) {
		const listed = await this.daemon.templates(dir);
		const templates = listed.ok ? listed.value.templates : [];
		const picks: StartPick[] = [
			{ label: nls.localize("mete/run/choose", "Let METE choose") },
			...templates.map((t) => ({
				label: t.name,
				...(t.description ? { description: t.description } : {}),
				templateId: t.id,
			})),
			{
				label: nls.localize("mete/run/single", "Single agent"),
				templateId: null,
			},
		];
		return this.quick.pick(picks, {
			placeHolder: nls.localize(
				"mete/run/pickStart",
				"Which team should work on it?",
			),
		});
	}

	// The router picks a team before the run exists (docs/08), which can take a minute on free
	// models, and the daemon has nothing to send until then; a progress message says it is busy.
	protected async starting(dir: string, req: RunStart) {
		const progress = await this.messages.showProgress({
			text: nls.localize("mete/run/starting", "METE is starting the run…"),
		});
		try {
			return await this.daemon.startRun(dir, req);
		} finally {
			progress.cancel();
		}
	}

	// The router's suggestions first, then a single agent (docs/08, Router).
	protected pickTeam(suggestions: readonly string[]) {
		const picks: TeamPick[] = [
			...suggestions.map((id) => ({ label: id, templateId: id })),
			{
				label: nls.localize("mete/run/single", "Single agent"),
				templateId: null,
			},
		];
		return this.quick.pick(picks, {
			placeHolder: nls.localize(
				"mete/run/pickTeam",
				"METE is not sure which team fits this goal; choose one",
			),
		});
	}
}
