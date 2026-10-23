import type { App } from "../infrastructure/app.js";

// Only the error stream is needed; naming Io from commands.ts would make an import cycle.
type Err = { readonly err: (line: string) => void };

// The start checks of a run (ADR-044, Phase 5 onboarding): what the terminal says before a run
// starts when the folder lacks something a run relies on.

/** Said before a run starts when vcs-git is not active (docs/08: tasks then work in place). */
export const NO_GIT_LINE =
	"This folder is not a git repository (or git is not installed): tasks work in place, without worktrees or checkpoints.";

// A repository without a commit keeps vcs-git active; docs/08 logs that case when a task starts.
/** Prints the start lines for this folder. */
export const noteStart = (app: App, io: Err) => {
	if (app.inactive.some((m) => m.moduleId === "vcs-git")) io.err(NO_GIT_LINE);
};
