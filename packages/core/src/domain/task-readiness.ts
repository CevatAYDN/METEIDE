import type { TeamState } from "./team-schema.js";

/** Eligible tasks, in template order; dependency approvals count only after their worktree landed. */
export const readyTasks = (team: TeamState) =>
	team.template.tasks.flatMap((task) => {
		const status = team.tasks[task.id]?.status;
		const ready = (task.context ?? []).every(
			(id) =>
				team.tasks[id]?.status === "approved" &&
				!team.tasks[id]?.context.worktree,
		);
		return ready && (status === "todo" || status === "changes_requested")
			? [task.id]
			: [];
	});
