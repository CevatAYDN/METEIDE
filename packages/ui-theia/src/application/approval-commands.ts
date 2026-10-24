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
import {
	waitsForQuota,
	waitsForUser,
	waitsForYou,
} from "../domain/home-model.js";
import {
	type DaemonFailure,
	MeteDaemonService,
	type StatusRuns,
} from "../domain/status-service.js";
import { failureText, noFolderText, plain } from "./status-text.js";

// The approvals inbox's actions (ADR-048), as palette commands so the keyboard reaches them; the
// Home view's buttons run the same commands with the run id. Without one they ask which run.

// Written out one by one, so Theia's nls-extract can read each label and key.
/** "METE: Approve run". */
export const APPROVE_RUN_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.run.approve", category: "METE", label: "Approve run" },
	"mete/run/approve",
	"mete/category",
);
/** "METE: Revise run": sends the waiting task back with feedback. */
export const REVISE_RUN_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.run.revise", category: "METE", label: "Revise run" },
	"mete/run/revise",
	"mete/category",
);
/** "METE: Resume run". */
export const RESUME_RUN_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.run.resume", category: "METE", label: "Resume run" },
	"mete/run/resume",
	"mete/category",
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
			execute: (runId?: unknown, feedback?: unknown) =>
				this.decide("revise", runId, feedback),
		});
		commands.registerCommand(RESUME_RUN_COMMAND, {
			execute: (runId?: unknown) => this.resume(runId),
		});
	}

	// Revise's feedback comes typed from the Team panel's strip (ADR-091), or else from a quick input.
	protected async decide(
		decision: "approve" | "revise",
		given: unknown,
		typed?: unknown,
	) {
		const t = await this.target(given, waitsForYou);
		if (!t) return;
		const input =
			decision === "approve"
				? { decision }
				: typeof typed === "string" && typed.trim()
					? { decision, feedback: typed.trim() }
					: await this.feedback();
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
		// A quota pause may be resumed before its reset (ADR-059), a user's pause or a quit's any time (ADR-061).
		const t = await this.target(
			given,
			(r) => waitsForYou(r) || waitsForQuota(r) || waitsForUser(r),
		);
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

	// The run the command was given, or one picked among those `offered`.
	protected async target(
		given: unknown,
		offered: (r: StatusRuns[number]) => boolean,
	): Promise<Target | undefined> {
		const root = this.workspace.tryGetRoots()[0];
		if (!root) return void this.messages.info(noFolderText());
		const dir = root.resource.path.fsPath();
		if (typeof given === "string" && given) return { dir, runId: given };
		const runs = await this.daemon.status(dir);
		if (!runs.ok) return this.warned(runs.error);
		const picks: RunPick[] = runs.value.filter(offered).map((r) => ({
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
