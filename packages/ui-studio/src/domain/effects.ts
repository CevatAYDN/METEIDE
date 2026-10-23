import type { MeteEvent } from "@mete/contracts";
import type { Layout, Point } from "./layout.js";
import type { TeamView } from "./team-view.js";

// What the studio shows when a live event arrives (docs/13, the event table; ADR-052): the notes
// and characters whose place changed move there (a new note drops onto the board, an agent walks
// to or from the coffee corner), and some events add a mark or a burst. Effects play for live
// events only; a panel opened later draws the state. An effect aimed at a role plays at that
// role's first character and is skipped when it has none. shortcut: the assigner's envelope of
// task.assigned (the event names no assigner), the work shown on a monitor (a short glyph of the
// tool's domain instead) and the rows whose events no module publishes yet (agent.message.sent,
// review.requested, vault.note.saved) come with the theme module.

/** A token colour an effect is drawn in. */
export type EffectColour = "good" | "accent" | "warn" | "bad";

/** One animation the stage plays over the room. */
export type Effect =
	| {
			readonly kind: "move";
			/** `note:<task id>`, `head:<character id>`, or `envelope`. */
			readonly target: string;
			readonly from: Point;
			readonly to: Point;
	  }
	| {
			readonly kind: "burst";
			readonly at: Point;
			readonly colour: EffectColour;
	  }
	| {
			readonly kind: "mark";
			readonly at: Point;
			readonly text: string;
			readonly colour: EffectColour;
	  }
	| { readonly kind: "dim"; readonly on: boolean }
	| { readonly kind: "jump"; readonly at: readonly Point[] };

/** The room before or after the event. */
export type Frame = { readonly layout: Layout; readonly view: TeamView };

const moved = (a: Point, b: Point) => a.x !== b.x || a.y !== b.y;

const moves = (before: Frame, after: Frame): Effect[] => {
	const out: Effect[] = [];
	for (const [id, to] of Object.entries(after.layout.notes)) {
		const from = before.layout.notes[id] ?? {
			x: to.x,
			y: after.layout.board.y - 24,
		};
		if (moved(from, to))
			out.push({ kind: "move", target: `note:${id}`, from, to });
	}
	for (const [id, to] of Object.entries(after.layout.heads)) {
		const from = before.layout.heads[id];
		if (from && moved(from, to))
			out.push({ kind: "move", target: `head:${id}`, from, to });
	}
	return out;
};

// A character's head by agent id; a grouped character stands under its role's id.
const headOfAgent = (f: Frame, agentId: string | undefined) => {
	const agent = f.view.agents.find((a) => a.id === agentId);
	return agent
		? (f.layout.heads[agent.id] ?? f.layout.heads[agent.roleId])
		: undefined;
};

const headOfRole = (f: Frame, roleId: string | undefined) =>
	headOfAgent(f, f.view.agents.find((a) => a.roleId === roleId)?.id);

const TOOL_GLYPHS: Readonly<Record<string, string>> = {
	fs: "{ }",
	web: "www",
	media: "img",
	"3d": "3d",
	shell: ">_",
	vcs: "git",
	gameengine: "test",
	browser: "web",
	seo: "seo",
};

const above = (p: Point, dy = 40): Point => ({ x: p.x, y: p.y - dy });

type Task = {
	readonly note?: Point;
	readonly agent?: Point;
	readonly approver?: Point;
};

const STATUS: Partial<Record<string, (t: Task) => Effect[]>> = {
	approved: ({ note, approver }) => [
		...(note ? [{ kind: "burst", at: note, colour: "good" } as const] : []),
		...(approver
			? [{ kind: "burst", at: above(approver, 20), colour: "accent" } as const]
			: []),
	],
	changes_requested: ({ agent, approver }) =>
		agent
			? [
					...(approver
						? [
								{
									kind: "move",
									target: "envelope",
									from: approver,
									to: agent,
								} as const,
							]
						: []),
					{ kind: "mark", at: above(agent), text: "!", colour: "warn" },
				]
			: [],
	blocked: ({ note, agent }) => [
		...(note
			? [{ kind: "mark", at: note, text: "!", colour: "bad" } as const]
			: []),
		...(agent
			? [{ kind: "mark", at: above(agent), text: "!", colour: "bad" } as const]
			: []),
	],
};

const statusEffects = (
	e: Extract<MeteEvent, { type: "task.status.changed" }>,
	f: Frame,
): Effect[] => {
	const task = f.view.tasks.find((t) => t.id === e.taskId);
	const anchors: Task = {
		...(e.taskId && f.layout.notes[e.taskId]
			? { note: f.layout.notes[e.taskId] }
			: {}),
		...optional("agent", headOfAgent(f, task?.agentId)),
		...optional("approver", headOfRole(f, task?.approver)),
	};
	return STATUS[e.payload.to]?.(anchors) ?? [];
};

const optional = <K extends string>(key: K, p: Point | undefined) =>
	(p ? { [key]: p } : {}) as Partial<Record<K, Point>>;

const toolEffects = (
	e: Extract<MeteEvent, { type: "agent.tool.called" }>,
	f: Frame,
): Effect[] => {
	const head = headOfAgent(f, e.agentId);
	const domain = e.payload.capability.split(".")[0] ?? "";
	return head
		? [
				{
					kind: "mark",
					at: above(head, 48),
					text: TOOL_GLYPHS[domain] ?? "...",
					colour: "accent",
				},
			]
		: [];
};

const humanAsked = (
	e: Extract<MeteEvent, { type: "approval.requested" }>,
	f: Frame,
): Effect[] => {
	if (e.payload.approver !== "human") return [];
	const role =
		f.view.tasks.find((t) => t.id === e.taskId)?.approver ??
		f.view.signals.leadRoles[0];
	const lead = headOfRole(f, role);
	return lead
		? [{ kind: "mark", at: above(lead), text: "!", colour: "accent" }]
		: [];
};

const completed = (f: Frame): Effect[] => {
	const heads = Object.values(f.layout.heads);
	return [
		...heads.map(
			(at): Effect => ({ kind: "burst", at: above(at, 20), colour: "good" }),
		),
		{ kind: "jump", at: heads },
	];
};

const eventEffects = (e: MeteEvent, f: Frame): Effect[] => {
	switch (e.type) {
		case "task.status.changed":
			return statusEffects(e, f);
		case "agent.tool.called":
			return toolEffects(e, f);
		case "approval.requested":
			return humanAsked(e, f);
		case "run.paused":
			return e.payload.reason === "network" ? [{ kind: "dim", on: true }] : [];
		case "run.resumed":
		case "network.restored":
			return [{ kind: "dim", on: false }];
		case "run.completed":
			return completed(f);
		default:
			return [];
	}
};

// A character that walked into the coffee corner on a spent quota gets a floating "z".
const naps = (e: MeteEvent, before: Frame, after: Frame): Effect[] =>
	e.type === "quota.exhausted" ||
	(e.type === "run.paused" && e.payload.reason === "quota")
		? Object.entries(after.layout.heads)
				.filter(([id, at]) => moved(before.layout.heads[id] ?? at, at))
				.map(
					([, at]): Effect => ({
						kind: "mark",
						at: above(at, 32),
						text: "z",
						colour: "warn",
					}),
				)
		: [];

/** The effects of one live event, from the room before it to the room after it. */
export const effectsOf = (
	e: MeteEvent,
	before: Frame,
	after: Frame,
): Effect[] => [
	...moves(before, after),
	...eventEffects(e, after),
	...naps(e, before, after),
];
