import {
	type TaskList,
	TaskListSchema,
	TEMPLATE_DEFAULTS,
	type TeamTemplate,
} from "@mete/contracts";
import { type Checked, jsonOf } from "./guardrail.js";
import { type TeamState, todoEntry } from "./team.js";

// spawns (docs/08, ADR-057): a task's approved task-list@1 becomes tasks of the same run, added to
// the run's copy of the template so a resumed run keeps them. Pure.

type TaskDef = TeamTemplate["tasks"][number];

const defOf = (team: TeamState, id: string) =>
	team.template.tasks.find((t) => t.id === id);

const spawns = (team: TeamState, id: string) =>
	defOf(team, id)?.spawns === true;

/** The guardrail a spawns task gets when its template names none: its expected task-list@1. */
export const spawnGuardrail = (team: TeamState, id: string) =>
	spawns(team, id) &&
	defOf(team, id)?.expected_output === "artifact:task-list@1"
		? {
				schema: "task-list@1",
				max_retries: TEMPLATE_DEFAULTS.guardrailMaxRetries,
			}
		: undefined;

const listOf = (report: string | undefined): TaskList | undefined => {
	const json = report === undefined ? undefined : jsonOf(report);
	const r = json && TaskListSchema.safeParse(json.value);
	return r?.success ? r.data : undefined;
};

/** What a spawns task's list gets wrong against the template, as guardrail issues; none when it fits. */
export const spawnIssues = (team: TeamState, id: string, report: string) => {
	if (!spawns(team, id)) return undefined;
	const roles = team.template.roles.map((r) => r.id);
	const issues = (listOf(report)?.tasks ?? []).flatMap((t, i) => [
		...(defOf(team, t.id)
			? [`tasks.${i}.id: ${t.id} is already a task of the template`]
			: []),
		...(roles.includes(t.role)
			? []
			: [`tasks.${i}.role: ${t.role} is not a role of the template`]),
	]);
	return issues.length > 0 ? issues.join("\n") : undefined;
};

const spawned = (
	template: TeamTemplate,
	parent: string,
	t: TaskList["tasks"][number],
): TaskDef => ({
	...template.spawn_defaults?.[t.role],
	id: t.id,
	role: t.role,
	title: t.title,
	context: [parent, ...(t.dependsOn ?? [])],
});

/** Adds the tasks of an approved spawns task, once; `created` names the ones added now. */
export const withSpawned = (
	team: TeamState,
	id: string,
	newId: () => string = () => crypto.randomUUID(),
): { team: TeamState; created: string[] } => {
	const entry = team.tasks[id];
	const list = spawns(team, id) ? listOf(entry?.context.report) : undefined;
	if (entry?.status !== "approved" || !list) return { team, created: [] };
	const fresh = list.tasks.filter((t) => !defOf(team, t.id));
	const defs = fresh.map((t) => spawned(team.template, id, t));
	const template = {
		...team.template,
		tasks: [...team.template.tasks, ...defs],
	};
	const tasks = { ...team.tasks };
	for (const d of defs) tasks[d.id] = todoEntry(template, newId());
	return { team: { template, tasks }, created: defs.map((d) => d.id) };
};

/** A spawned task's acceptance sentences, from the list of the task that spawned it. */
export const acceptanceOf = (team: TeamState, id: string): string[] => {
	const parent = defOf(team, id)?.context?.find((c) => spawns(team, c));
	const list = parent ? listOf(team.tasks[parent]?.context.report) : undefined;
	return [...(list?.tasks.find((t) => t.id === id)?.acceptance ?? [])];
};

/** A passed guardrail check that a spawns task's list still fails against the template. */
export const checkSpawns = (
	team: TeamState,
	id: string,
	checked: Checked,
): Checked => {
	const issues = checked.ok ? spawnIssues(team, id, checked.report) : undefined;
	return issues === undefined ? checked : { ok: false, issues };
};
