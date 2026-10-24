import type { TeamView } from "./team-draft.js";

// The order a run can start a team's tasks in (ADR-093): the tasks that wait for none first, then
// those whose waited-for tasks have all come before, each round in the file's order. A task that
// waits for an id no task has is not held back (the schema refuses it on Save); tasks that wait for
// each other can never start, so they come last in the file's order.

/** The approver of a task, for the screen to word. */
export type Approver =
	| { readonly kind: "human" }
	| { readonly kind: "role"; readonly name: string };

/** One task in the order of work. */
export type Step = {
	readonly title: string;
	/** The index of the member whose task it is in the team's roles, or -1 when no member has its id. */
	readonly member: number;
	readonly memberName: string;
	/** The titles of the tasks it waits for. */
	readonly after: readonly string[];
	readonly approver: Approver | undefined;
	/** Whether the human approves it too, after its approver (`policies.human_checkpoints`). */
	readonly checkpoint: boolean;
};

type Task = TeamView["tasks"][number];

const startOrder = (tasks: readonly Task[]): number[] => {
	const known = new Set(tasks.map((t) => t.id));
	const done = new Set<string>();
	const out: number[] = [];
	let left = tasks.map((_, i) => i);
	while (left.length > 0) {
		const ready = left.filter((i) =>
			(tasks[i]?.context ?? []).every((c) => !known.has(c) || done.has(c)),
		);
		if (ready.length === 0) return [...out, ...left];
		for (const i of ready) done.add(tasks[i]?.id ?? "");
		out.push(...ready);
		left = left.filter((i) => !ready.includes(i));
	}
	return out;
};

const approverOf = (team: TeamView, t: Task): Approver | undefined => {
	if (!t.approval) return undefined;
	if (t.approval === "human") return { kind: "human" };
	const role = team.roles.find((r) => r.id === t.approval);
	return { kind: "role", name: role?.name || t.approval };
};

const stepOf = (
	team: TeamView,
	byId: ReadonlyMap<string, Task>,
	t: Task,
): Step => {
	const title = (x: Task) => x.title || x.id;
	const member = team.roles.findIndex((r) => r.id === t.role);
	return {
		title: title(t),
		member,
		memberName: team.roles[member]?.name || t.role,
		after: t.context.flatMap((c) => {
			const x = byId.get(c);
			return x ? [title(x)] : [];
		}),
		approver: approverOf(team, t),
		checkpoint: team.policies.human_checkpoints.includes(t.id),
	};
};

/** The team's tasks in the order they can start. */
export const orderOfWork = (team: TeamView): Step[] => {
	const byId = new Map(team.tasks.map((t) => [t.id, t]));
	return startOrder(team.tasks).flatMap((i) => {
		const t = team.tasks[i];
		return t ? [stepOf(team, byId, t)] : [];
	});
};
