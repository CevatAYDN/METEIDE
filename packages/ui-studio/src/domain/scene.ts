import { DESKS_PER_ROW, GROUP_ABOVE_AGENTS } from "../defaults.js";
import type { AgentCard } from "./agents.js";
import { type Place, placeOf, type TeamView } from "./team-view.js";

// What the studio room shows for a team view (docs/13, Scene layout; ADR-052), as data the stage
// draws: rows of desks with one character each, the lead roles' rows first, and the task notes of
// the wall board. A character waits at the coffee corner while its run is paused for quota and its
// provider's quota is spent. shortcut: a grouped character shows the state of its role's first agent.

/** What a character is doing. */
export type CharacterState = "idle" | "thinking" | "working" | "waiting";

/** One character at a desk: an agent, or a role standing for its agents above the group limit. */
export type Character = {
	readonly id: string;
	readonly roleId: string;
	/** How many agents it stands for: 1, or the group's size. */
	readonly count: number;
	readonly state: CharacterState;
	/** The capability of the tool call it works on, while working. */
	readonly tool?: string;
	/** When the quota it waits for opens again, while waiting. */
	readonly resetsAt?: string;
};

/** A task note on the wall board. */
export type Note = { readonly id: string; readonly title: string };

/** The room: desk rows top to bottom, and the board's notes by column. */
export type Scene = {
	readonly rows: readonly (readonly Character[])[];
	readonly notes: Readonly<Record<Place["column"], readonly Note[]>>;
	/** The run waits for the network: monitors show the offline icon and the room is shaded. */
	readonly offline?: boolean;
};

const characterOf = (view: TeamView, a: AgentCard, count = 1): Character => {
	const base = { id: count > 1 ? a.roleId : a.id, roleId: a.roleId, count };
	const resetsAt = view.signals.exhausted[a.providerId];
	if (view.signals.pausedFor === "quota" && resetsAt)
		return { ...base, state: "waiting", resetsAt };
	if (a.tool) return { ...base, state: "working", tool: a.tool };
	return { ...base, state: a.thinking ? "thinking" : "idle" };
};

const charactersOf = (view: TeamView): Character[] => {
	if (view.agents.length <= GROUP_ABOVE_AGENTS)
		return view.agents.map((a) => characterOf(view, a));
	const byRole = new Map<string, AgentCard[]>();
	for (const a of view.agents)
		byRole.set(a.roleId, [...(byRole.get(a.roleId) ?? []), a]);
	return [...byRole.values()].flatMap((group) => {
		const [first] = group;
		return first ? [characterOf(view, first, group.length)] : [];
	});
};

const chunk = <T>(items: readonly T[]): T[][] => {
	const rows: T[][] = [];
	for (let i = 0; i < items.length; i += DESKS_PER_ROW)
		rows.push(items.slice(i, i + DESKS_PER_ROW));
	return rows;
};

/** The studio room for a team view. */
export const sceneOf = (view: TeamView): Scene => {
	const characters = charactersOf(view);
	const leads = new Set(view.signals.leadRoles);
	const notes: Record<Place["column"], Note[]> = {
		todo: [],
		in_progress: [],
		done: [],
	};
	for (const t of view.tasks)
		notes[placeOf(t.status).column].push({ id: t.id, title: t.title });
	return {
		rows: [
			...chunk(characters.filter((c) => leads.has(c.roleId))),
			...chunk(characters.filter((c) => !leads.has(c.roleId))),
		],
		notes,
		...(view.signals.pausedFor === "network" ? { offline: true } : {}),
	};
};
