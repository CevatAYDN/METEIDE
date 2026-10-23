import { TOKENS, type TokenMode } from "@mete/ui-kit";
import { type Layout, layoutOf, type Point } from "./layout.js";
import type { Character, CharacterState, Scene } from "./scene.js";

// The studio room as primitives the stage draws (ADR-052: shapes before sprites, colours from the
// design tokens): the wall board with its notes, the coffee corner with the agents waiting for
// quota, and the desk rows. Pure, so the layout is tested without WebGL; the canvas text comes
// localized from the caller.

/** One thing to draw, in canvas pixels. */
export type Primitive =
	| {
			readonly kind: "rect";
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
			readonly fill: string;
			readonly stroke?: string;
	  }
	| {
			readonly kind: "circle";
			readonly x: number;
			readonly y: number;
			readonly r: number;
			readonly fill: string;
	  }
	| {
			readonly kind: "text";
			readonly x: number;
			readonly y: number;
			readonly text: string;
			readonly fill: string;
			readonly size: number;
	  };

/** The words on the canvas, in the user's language. */
export type StageLabels = {
	readonly todo: string;
	readonly inProgress: string;
	readonly done: string;
	readonly coffee: string;
	/** The countdown under a waiting character, from its quota's reset time. */
	readonly until: (resetsAt: string) => string;
};

type Colours = (typeof TOKENS)[TokenMode];

const stateColour = (c: Colours): Record<CharacterState, string> => ({
	idle: c.muted,
	thinking: c.accent,
	working: c.good,
	waiting: c.warn,
});

const NOTE_COLOUR = (c: Colours) => ({
	todo: c.chip,
	in_progress: c.warn,
	done: c.good,
});

const board = (
	scene: Scene,
	l: Layout,
	c: Colours,
	labels: StageLabels,
): Primitive[] => {
	const titles = {
		todo: labels.todo,
		in_progress: labels.inProgress,
		done: labels.done,
	};
	const out: Primitive[] = [
		{ kind: "rect", ...l.board, fill: c.panel, stroke: c.line },
	];
	for (const column of ["todo", "in_progress", "done"] as const) {
		const at = l.columns[column];
		const notes = scene.notes[column];
		out.push({
			kind: "text",
			...at,
			text: `${titles[column]} (${notes.length})`,
			fill: c.ink,
			size: 13,
		});
		for (const note of notes) {
			const p = l.notes[note.id];
			if (p)
				out.push({
					kind: "rect",
					...p,
					w: 18,
					h: 18,
					fill: NOTE_COLOUR(c)[column],
				});
		}
	}
	return out;
};

// What a character's state adds above or below it: a count badge, thinking dots, its tool, its countdown.
const marks = (
	ch: Character,
	{ x, y }: Point,
	c: Colours,
	until?: string,
): Primitive[] => {
	const out: Primitive[] = [];
	if (ch.count > 1) {
		out.push({ kind: "circle", x: x + 16, y: y - 14, r: 9, fill: c.accent });
		out.push({
			kind: "text",
			x: x + 12,
			y: y - 21,
			text: String(ch.count),
			fill: c.panel,
			size: 11,
		});
	}
	if (ch.state === "thinking")
		for (const dx of [-8, 0, 8])
			out.push({
				kind: "circle",
				x: x + dx,
				y: y - 26,
				r: 2.5,
				fill: c.accent,
			});
	if (ch.state === "working" && ch.tool)
		out.push({
			kind: "text",
			x: x - 52,
			y: y + 44,
			text: ch.tool,
			fill: c.muted,
			size: 11,
		});
	if (ch.state === "waiting" && until)
		out.push({
			kind: "text",
			x: x - 22,
			y: y + 52,
			text: until,
			fill: c.muted,
			size: 10,
		});
	return out;
};

const person = (
	ch: Character,
	at: Point,
	c: Colours,
	until?: string,
): Primitive[] => [
	{ kind: "circle", x: at.x, y: at.y, r: 16, fill: stateColour(c)[ch.state] },
	// Inside the desk below the character, clear of the desk's top edge.
	{
		kind: "text",
		x: at.x - 40,
		y: at.y + 30,
		text: ch.roleId,
		fill: c.ink,
		size: 12,
	},
	...marks(ch, at, c, until),
];

const people = (
	scene: Scene,
	l: Layout,
	c: Colours,
	labels: StageLabels,
): Primitive[] =>
	scene.rows.flat().flatMap((ch) => {
		const head = l.heads[ch.id];
		if (!head) return [];
		return person(
			ch,
			head,
			c,
			ch.resetsAt ? labels.until(ch.resetsAt) : undefined,
		);
	});

/** The primitives of the room, for a canvas of `width` pixels in the colours of `mode`. */
export const paintScene = (
	scene: Scene,
	mode: TokenMode,
	width: number,
	labels: StageLabels,
): Primitive[] => {
	const c = TOKENS[mode];
	const l = layoutOf(scene, width);
	return [
		{ kind: "rect", x: 0, y: 0, w: width, h: l.height, fill: c.bg },
		...board(scene, l, c, labels),
		{ kind: "rect", ...l.coffee, fill: c.chip, stroke: c.line },
		{
			kind: "text",
			x: l.coffee.x + 8,
			y: l.coffee.y + 8,
			text: labels.coffee,
			fill: c.ink,
			size: 13,
		},
		...l.desks.map(
			(d): Primitive => ({
				kind: "rect",
				x: d.x,
				y: d.y,
				w: d.w,
				h: d.h,
				fill: c.panel,
				stroke: c.line,
			}),
		),
		...people(scene, l, c, labels),
	];
};
