import type { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import type { Shown } from "../application/board-session.js";
import type { ThreadHistoryState } from "../application/thread-history.js";
import { createThreadPanel } from "../application/thread-panel.js";
import type { MeteEditorContext } from "./editor-context-service.js";

type Deps = {
	readonly daemon: Parameters<typeof createThreadPanel>[0]["daemon"];
	readonly context: () => MeteEditorContext | undefined;
	readonly shown: () => Shown | undefined;
	readonly currentDir: () => string | undefined;
	readonly disposed: () => boolean;
	readonly leave: () => void;
	readonly show: (dir: string, runId: string, goal: string) => Promise<void>;
	readonly remove: (runId: string) => void;
	readonly onChange: () => void;
};
const currentShown = (deps: Deps) =>
	deps.disposed() || deps.shown()?.dir !== deps.currentDir()
		? undefined
		: deps.shown();

const syncHistory = (deps: Deps, state: ThreadHistoryState) => {
	const shown = currentShown(deps);
	const conversation =
		state.phase === "ready" ? state.result?.conversation : undefined;
	deps
		.context()
		?.select(
			conversation ? shown?.dir : undefined,
			conversation?.id,
			!!shown && conversation?.head.id === shown.runId,
		);
};

/** Navigation and every history resolution control attachment authority, not the rendered buttons. */
export const createBoardContext = (deps: Deps) => {
	const panel = createThreadPanel({
		...deps,
		drafts: () => deps.context()?.drafts,
		shown: () => currentShown(deps),
		onHistoryChange: (state) => syncHistory(deps, state),
	});
	const clear = () => {
		deps.leave();
		deps.context()?.select(undefined, undefined, false);
		panel.clear();
	};
	return {
		...panel,
		clear,
		dispose: () => {
			clear();
			deps.context()?.select();
		},
		selectInitial: () => deps.context()?.select(deps.currentDir()),
		selectRun: (shown: Shown) => {
			void panel.context.show(shown);
		},
		controls: () => {
			const controls = panel.controls();
			return {
				...controls,
				attachments: controls.conversationKey
					? deps
							.context()
							?.render(controls.conversationKey, !controls.replyReady)
					: undefined,
			};
		},
	};
};

/** Workspace navigation retires attachment authority before showing the other folder's draft. */
export const boardContextListeners = (
	context: MeteEditorContext | undefined,
	workspace: WorkspaceService,
	update: () => void,
	navigate: () => void,
) => [
	...(context ? [context.onDidChange(update)] : []),
	...(workspace.onWorkspaceChanged
		? [workspace.onWorkspaceChanged(navigate)]
		: []),
];
