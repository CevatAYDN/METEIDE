import type { Scene } from "./scene.js";
import type { Place } from "./team-view.js";

// Where everything of the studio room sits (docs/13, Scene layout; ADR-052), by id, so the painter
// and the effects share the same anchors: the wall board and its shown notes, the coffee corner,
// and each character's desk and head (a waiting character's head is in the coffee corner).

/** A point on the canvas. */
export type Point = { readonly x: number; readonly y: number };

/** A rectangle on the canvas. */
export type Box = Point & { readonly w: number; readonly h: number };

/** The room's anchors for a canvas width. */
export type Layout = {
	readonly width: number;
	readonly height: number;
	readonly board: Box;
	readonly coffee: Box;
	/** Where each column's title starts. */
	readonly columns: Readonly<Record<Place["column"], Point>>;
	/** Each shown note's top-left corner, by task id. */
	readonly notes: Readonly<Record<string, Point>>;
	/** Each character's head, by character id. */
	readonly heads: Readonly<Record<string, Point>>;
	/** Each character's desk, empty while it waits in the coffee corner. */
	readonly desks: readonly (Box & { readonly id: string })[];
};

const PAD = 16;
const BOARD_H = 132;
const COFFEE_W = 170;
const DESK_W = 120;
const DESK_H = 56;
const ROW_H = 128;
const NOTES_SHOWN = 5;
const NOTE_STEP = 22;
const COLUMN_ORDER: readonly Place["column"][] = [
	"todo",
	"in_progress",
	"done",
];

const boardOf = (scene: Scene, width: number) => {
	const board = {
		x: PAD,
		y: PAD,
		w: Math.max(240, width - COFFEE_W - 3 * PAD),
		h: BOARD_H,
	};
	const columns = {} as Record<Place["column"], Point>;
	const notes: Record<string, Point> = {};
	COLUMN_ORDER.forEach((column, i) => {
		const x = PAD + (i * board.w) / 3 + 8;
		columns[column] = { x, y: PAD + 8 };
		scene.notes[column].slice(0, NOTES_SHOWN).forEach((note, n) => {
			notes[note.id] = { x: x + n * NOTE_STEP, y: PAD + 34 };
		});
	});
	return { board, columns, notes };
};

const seatsOf = (scene: Scene, coffee: Box) => {
	const heads: Record<string, Point> = {};
	const desks: (Box & { id: string })[] = [];
	let waiting = 0;
	for (const [r, row] of scene.rows.entries())
		for (const [i, ch] of row.entries()) {
			const x = PAD + i * (DESK_W + PAD);
			const y = PAD + BOARD_H + 48 + r * ROW_H;
			desks.push({ id: ch.id, x, y: y + 24, w: DESK_W, h: DESK_H });
			heads[ch.id] =
				ch.state === "waiting"
					? { x: coffee.x + 30 + waiting++ * 52, y: coffee.y + 62 }
					: { x: x + DESK_W / 2, y };
		}
	return { heads, desks };
};

/** The anchors of the room for a canvas of `width` pixels. */
export const layoutOf = (scene: Scene, width: number): Layout => {
	const coffee = { x: width - COFFEE_W - PAD, y: PAD, w: COFFEE_W, h: BOARD_H };
	return {
		width,
		height: PAD + BOARD_H + 48 + scene.rows.length * ROW_H + PAD,
		coffee,
		...boardOf(scene, width),
		...seatsOf(scene, coffee),
	};
};
