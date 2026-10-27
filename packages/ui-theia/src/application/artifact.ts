import type { TeamView } from "@mete/ui-studio";

// Which report the approvals inbox opens for a run (docs/13: approvals with an artifact preview):
// the one of the task that waits for review, else the latest any task wrote. shortcut: the diff
// of the inbox row needs the run's worktree through vcs.git@2 and comes later.

/** The artifact path, relative to the workspace, the inbox opens for the run's view. */
export const artifactToOpen = (view: TeamView): string | undefined => {
	const waiting = view.tasks.find(
		(t) => t.status === "submitted" && t.artifactPath,
	);
	const latest = [...view.tasks].reverse().find((t) => t.artifactPath);
	return (waiting ?? latest)?.artifactPath?.replaceAll("\\", "/");
};

/** The worktree of the task that waits for the human, whose files the inbox lists when the run has no report (ADR-133). */
export const worktreeToShow = (view: TeamView): string | undefined =>
	view.tasks.find((t) => t.worktree)?.worktree;
