import { withSpawned } from "../domain/spawn.js";
import type { TeamState } from "../domain/team.js";
import { type EngineState, emit, type Live } from "./run-state.js";

// task.created for a team's tasks (docs/07), for the template's at run start and for the tasks an
// approved spawns task adds (docs/08, ADR-057).

/** Publishes task.created for `ids`, in order, each naming the Task ids it waits for. */
export const announce = (
	s: EngineState,
	l: Live,
	team: TeamState,
	ids: readonly string[],
) => {
	const idOf = (id: string) => team.tasks[id]?.id ?? id;
	for (const t of team.template.tasks.filter((x) => ids.includes(x.id)))
		emit(
			s,
			l,
			{
				type: "task.created",
				payload: {
					title: t.title,
					roleId: t.role,
					dependsOn: (t.context ?? []).map(idOf),
				},
			},
			idOf(t.id),
		);
};

/**
 * The team after an approval: an approved spawns task adds its tasks. Apply the team first, then
 * call `announce` so the events follow the state they describe.
 */
export const afterApproval = (
	s: EngineState,
	l: Live,
	team: TeamState,
	id: string,
) => {
	const r = withSpawned(team, id);
	return { team: r.team, announce: () => announce(s, l, r.team, r.created) };
};
