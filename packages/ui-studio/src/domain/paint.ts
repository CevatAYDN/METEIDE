import { TOKENS, type TokenMode } from "@mete/ui-kit";
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

const PAD = 16;
const BOARD_H = 132;
const COFFEE_W = 170;
const DESK_W = 120;
const DESK_H = 56;
const ROW_H = 128;
const NOTES_SHOWN = 5;

type Colours = (typeof TOKENS)[TokenMode];

const stateColour = (c: Colours): Record<CharacterState, string> => ({
	idle: c.muted,
	thinking: c.accent,
	working: c.good,
	waiting: c.warn,
});

const board = (
	scene: Scene,
	c: Colours,
	labels: StageLabels,
	width: number,
): Primitive[] => {
	const w = Math.max(240, width - COFFEE_W - 3 * PAD);
	const col = w / 3;
	const columns = [
		[labels.todo, scene.notes.todo, c.chip],
		[labels.inProgress, scene.notes.in_progress, c.warn],
		[labels.done, scene.notes.done, c.good],
	] as const;
	const out: Primitive[] = [
		{
			kind: "rect",
			x: PAD,
			y: PAD,
			w,
			h: BOARD_H,
			fill: c.panel,
			stroke: c.line,
		},
	];
	columns.forEach(([title, notes, fill], i) => {
		const x = PAD + i * col + 8;
		out.push({
			kind: "text",
			x,
			y: PAD + 8,
			text: `${title} (${notes.length})`,
			fill: c.ink,
			size: 13,
		});
		notes.slice(0, NOTES_SHOWN).forEach((_, n) => {
			out.push({
				kind: "rect",
				x: x + n * 22,
				y: PAD + 34,
				w: 18,
				h: 18,
				fill,
			});
		});
	});
	return out;
};

const person = (
	ch: Character,
	x: number,
	y: number,
	c: Colours,
): Primitive[] => {
	const out: Primitive[] = [
		{ kind: "circle", x, y, r: 16, fill: stateColour(c)[ch.state] },
		{
			kind: "text",
			x: x - 40,
			y: y + 22,
			text: ch.roleId,
			fill: c.ink,
			size: 12,
		},
	];
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
	return out;
};

const coffee = (
	scene: Scene,
	c: Colours,
	labels: StageLabels,
	width: number,
): Primitive[] => {
	const x = width - COFFEE_W - PAD;
	const out: Primitive[] = [
		{
			kind: "rect",
			x,
			y: PAD,
			w: COFFEE_W,
			h: BOARD_H,
			fill: c.chip,
			stroke: c.line,
		},
		{
			kind: "text",
			x: x + 8,
			y: PAD + 8,
			text: labels.coffee,
			fill: c.ink,
			size: 13,
		},
	];
	const waiting = scene.rows.flat().filter((ch) => ch.state === "waiting");
	waiting.slice(0, 3).forEach((ch, i) => {
		const cx = x + 30 + i * 52;
		out.push(...person(ch, cx, PAD + 62, c));
		if (ch.resetsAt)
			out.push({
				kind: "text",
				x: cx - 22,
				y: PAD + 100,
				text: labels.until(ch.resetsAt),
				fill: c.muted,
				size: 10,
			});
	});
	return out;
};

const desks = (scene: Scene, c: Colours): Primitive[] =>
	scene.rows.flatMap((row, r) =>
		row.flatMap((ch, i) => {
			const x = PAD + i * (DESK_W + PAD);
			const y = PAD + BOARD_H + 48 + r * ROW_H;
			const desk: Primitive = {
				kind: "rect",
				x,
				y: y + 24,
				w: DESK_W,
				h: DESK_H,
				fill: c.panel,
				stroke: c.line,
			};
			if (ch.state === "waiting") return [desk];
			const out = [desk, ...person(ch, x + DESK_W / 2, y, c)];
			if (ch.tool)
				out.push({
					kind: "text",
					x: x + 8,
					y: y + 44,
					text: ch.tool,
					fill: c.muted,
					size: 11,
				});
			return out;
		}),
	);

/** The primitives of the room, for a canvas of `width` pixels in the colours of `mode`. */
export const paintScene = (
	scene: Scene,
	mode: TokenMode,
	width: number,
	labels: StageLabels,
): Primitive[] => {
	const c = TOKENS[mode];
	const height = PAD + BOARD_H + 48 + scene.rows.length * ROW_H + PAD;
	return [
		{ kind: "rect", x: 0, y: 0, w: width, h: height, fill: c.bg },
		...board(scene, c, labels, width),
		...coffee(scene, c, labels, width),
		...desks(scene, c),
	];
};
