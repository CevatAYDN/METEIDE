import type { AllowScope } from "@mete/contracts";
import {
	APPROVE_RUN_COMMAND,
	RESUME_RUN_COMMAND,
	REVISE_RUN_COMMAND,
} from "../application/approval-commands.js";
import type { Shown } from "../application/board-session.js";
import type { TeamControls } from "../application/board-view.js";
import { waitsForQuota } from "../domain/home-model.js";
import type { MeteDaemonService } from "../domain/status-service.js";
import { FlowView } from "./flow-view.js";
import { StudioView } from "./studio-view.js";
import "../../style/mete-verification.css";

/** Status and quota facts belong only to the selection that requested them. */
export const readBoardRun = async (
	daemon: Pick<MeteDaemonService, "status" | "quota">,
	shown: Shown,
	current: () => boolean,
) => {
	if (!current()) return undefined;
	const result = await daemon.status(shown.dir, shown.runId);
	if (!result.ok || !current()) return undefined;
	const run = result.value.find((row) => row.id === shown.runId);
	if (!run) return undefined;
	const quota = waitsForQuota(run) ? await daemon.quota(shown.dir) : undefined;
	if (!current()) return undefined;
	const blocked = quota?.ok
		? quota.value.providers.filter((provider) => provider.state !== "ready")
		: [];
	return { run, blocked };
};

/** Retains the existing team scenes while the board also hosts conversation history. */
export const boardScenes = (
	active: boolean,
	onCoffee: () => void,
): Pick<TeamControls, "flow" | "studio"> => ({
	flow: (view) => <FlowView view={view} />,
	studio: (view, pulse) => (
		<StudioView
			view={view}
			active={active}
			onCoffee={onCoffee}
			{...(pulse ? { pulse } : {})}
		/>
	),
});

/** Keeps legacy run-level waits bound to the same commands and handlers. */
export const boardWaiting = (
	decide: (command: string, feedback?: string) => Promise<unknown>,
	allow: (scope: AllowScope) => Promise<string | undefined>,
	showFiles: (worktree: string, changed?: readonly string[]) => Promise<void>,
): TeamControls["waiting"] => ({
	onApprove: () => void decide(APPROVE_RUN_COMMAND.id),
	onRevise: (feedback) => void decide(REVISE_RUN_COMMAND.id, feedback),
	onResume: () => void decide(RESUME_RUN_COMMAND.id),
	onAllow: allow,
	onShowFiles: (worktree, changed) => void showFiles(worktree, changed),
});
