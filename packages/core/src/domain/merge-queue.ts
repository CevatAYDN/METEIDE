import type { TeamState } from "./team-schema.js";

/** Approved work is not landed until its worktree has been merged. */
export const unmergedTask = (team: TeamState, id: string) =>
	team.tasks[id]?.status === "approved" &&
	Boolean(team.tasks[id]?.context.worktree);

/** Old snapshots have no queue; their pending trees retain the historical template order. */
export const pendingMerges = (team: TeamState): string[] =>
	[
		...new Set([
			...(team.mergeQueue ?? []),
			...team.template.tasks.map((task) => task.id),
		]),
	].filter((id) => unmergedTask(team, id));

/** Record the last required approval once; persisted predecessors retain their positions. */
export const enqueueMerge = (team: TeamState, id: string): TeamState =>
	unmergedTask(team, id)
		? {
				...team,
				mergeQueue: [...pendingMerges(team).filter((task) => task !== id), id],
			}
		: team;

/** Only a successfully landed tree leaves the queue; failed merges remain at its head. */
export const dequeueMerge = (team: TeamState, id: string): TeamState =>
	team.mergeQueue
		? { ...team, mergeQueue: team.mergeQueue.filter((task) => task !== id) }
		: team;
