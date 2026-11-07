import type { AllowScope } from "@mete/contracts";
import {
	APPROVE_RUN_COMMAND,
	RESUME_RUN_COMMAND,
	REVISE_RUN_COMMAND,
} from "../application/approval-commands.js";
import type { TeamControls } from "../application/board-view.js";
import { FlowView } from "./flow-view.js";
import { StudioView } from "./studio-view.js";

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
