import type { ApprovalInput, Result } from "@mete/contracts";
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
import { waitsForYou } from "../domain/home-model.js";
import {
	type DaemonFailure,
	MeteDaemonService,
} from "../domain/status-service.js";
import { failureText, noFolderText, plain } from "./status-text.js";

// The approvals inbox's actions (ADR-048), as palette commands so the keyboard reaches them; the
// Home view's buttons run the same commands with the run id. Without one they ask which run.

const command = (id: string, label: string, key: string): Command =>
	Command.toLocalizedCommand(
		{ id, category: "METE", label },
		key,
		"mete/category",
	);

/** "METE: Approve run". */
export const APPROVE_RUN_COMMAND = command(
	"mete.run.approve",
	"Approve run",
	"mete/run/approve",
);
/** "METE: Revise run": sends the waiting task back with feedback. */
export const REVISE_RUN_COMMAND = command(
	"mete.run.revise",
	"Revise run",
	"mete/run/revise",
);
/** "METE: Resume run". */
export const RESUME_RUN_COMMAND = command(
	"mete.run.resume",
	"Resume run",
	"mete/run/resume",
);

type Target = { readonly dir: string; readonly runId: string };
type RunPick = QuickPickItem & { readonly runId: string };

@injectable()
export class MeteApprovalContribution implements CommandContribution {
	@inject(MessageService) protected readonly messages!: MessageService;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	@inject(QuickInputService) protected readonly quick!: QuickInputService;

	registerCommands(commands: CommandRegistry): void {
		commands.registerCommand(APPROVE_RUN_COMMAND, {
			execute: (runId?: unknown) => this.decide("approve", runId),
		});
		commands.registerCommand(REVISE_RUN_COMMAND, {
			execute: (runId?: unknown) => this.decide("revise", runId),
		});
		commands.registerCommand(RESUME_RUN_COMMAND, {
			execute: (runId?: unknown) => this.resume(runId),
		});
	}

	protected async decide(decision: "approve" | "revise", given: unknown) {
		const t = await this.target(given);
		if (!t) return;
		const input = decision === "approve" ? { decision } : await this.feedback();
		if (!input) return;
		const r = await this.daemon.approve(t.dir, t.runId, input);
		this.report(
			r,
			decision === "approve"
				? nls.localize("mete/run/approved", "Approved; the run goes on.")
				: nls.localize("mete/run/revised", "Sent back with your feedback."),
		);
	}

	protected async resume(given: unknown) {
		const t = await this.target(given);
		if (!t) return;
		const r = await this.daemon.resume(t.dir, t.runId);
		this.report(r, nls.localize("mete/run/resumed", "Resumed."));
	}

	// A revision needs feedback (docs/08); an empty answer gives up.
	protected async feedback(): Promise<ApprovalInput | undefined> {
		const text = (
			await this.quick.input({
				prompt: nls.localize("mete/run/feedback", "What should change?"),
				ignoreFocusLost: true,
			})
		)?.trim();
		return text ? { decision: "revise", feedback: text } : undefined;
	}

	// The run the command was given, or one picked among those that wait for the human.
	protected async target(given: unknown): Promise<Target | undefined> {
		const root = this.workspace.tryGetRoots()[0];
		if (!root) return void this.messages.info(noFolderText());
		const dir = root.resource.path.fsPath();
		if (typeof given === "string" && given) return { dir, runId: given };
		const runs = await this.daemon.status(dir);
		if (!runs.ok) return this.warned(runs.error);
		const picks: RunPick[] = runs.value.filter(waitsForYou).map((r) => ({
			label: r.goal,
			description:
				r.templateId ?? nls.localize("mete/run/single", "Single agent"),
			runId: r.id,
		}));
		if (picks.length === 0)
			return void this.messages.info(
				nls.localize("mete/run/noneWaiting", "No run waits for you."),
			);
		const pick = await this.quick.pick(picks, {
			placeHolder: nls.localize("mete/run/which", "Which run?"),
		});
		return pick ? { dir, runId: pick.runId } : undefined;
	}

	protected warned(failure: DaemonFailure): undefined {
		void this.messages.warn(failureText(failure, plain));
		return undefined;
	}

	protected report(r: Result<null, DaemonFailure>, done: string) {
		if (r.ok) void this.messages.info(done);
		else this.warned(r.error);
	}
}
