import { NOTES_PER_COLUMN, ROOM_W } from "../defaults.js";
import type { Scene } from "./scene.js";
import type { Place } from "./team-view.js";

// Where everything of the studio room sits (docs/13, Scene layout; ADR-070), by id, so the painter
// and the effects share the same anchors. The room has its own space, the demo's, ROOM_W wide; the
// stage scales it to the panel. The wall holds the board and the coffee corner, the floor the desk
// rows; a waiting character's head is in the coffee corner.

/** A point in the room's space. */
export type Point = { readonly x: number; readonly y: number };

/** A rectangle in the room's space. */
export type Box = Point & { readonly w: number; readonly h: number };

/** The room's anchors. */
export type Layout = {
	readonly width: number;
	readonly height: number;
	/** Where the wall ends and the floor starts. */
	readonly wall: number;
	readonly board: Box;
	/** The coffee corner: its counter and machine, the box a click opens the quota dashboard in. */
	readonly coffee: Box;
	/** Where each column's header starts. */
	readonly columns: Readonly<Record<Place["column"], Point>>;
	/** Each shown note's top-left corner, by task id. */
	readonly notes: Readonly<Record<string, Point>>;
	/** How many notes of each column the board has no room for. */
	readonly hidden: Readonly<Record<Place["column"], number>>;
	/** Each character's head, by character id. */
	readonly heads: Readonly<Record<string, Point>>;
	/** Each character's desk top, empty while it waits in the coffee corner. */
	readonly desks: readonly (Box & { readonly id: string })[];
};

const WALL = 176;
const ROW_Y = 330;
const ROW_STEP = 230;
const BOTTOM = 160;
const BOARD: Box = { x: 86, y: 24, w: 368, h: 130 };
const COLUMN_STEP = 119;
const NOTE_STEP = 27;
const COFFEE: Box = { x: 816, y: 76, w: 118, h: 134 };
const COFFEE_SPOT: Point = { x: 840, y: 178 };
const WAIT_STEP = 52;
const DESK_W = 156;
const DESK_H = 42;
// A seated head stands right of the desk's centre, above the chair; a standing one a head higher.
const HEAD_DX = 22;
const HEAD_DY = 58;
const COLUMN_ORDER: readonly Place["column"][] = [
	"todo",
	"in_progress",
	"done",
];

const boardOf = (scene: Scene) => {
	const columns = {} as Record<Place["column"], Point>;
	const hidden = {} as Record<Place["column"], number>;
	const notes: Record<string, Point> = {};
	COLUMN_ORDER.forEach((column, k) => {
		const x = BOARD.x + 12 + k * COLUMN_STEP;
		columns[column] = { x, y: BOARD.y + 12 };
		const all = scene.notes[column];
		hidden[column] = Math.max(0, all.length - NOTES_PER_COLUMN);
		all.slice(0, NOTES_PER_COLUMN).forEach((note, i) => {
			notes[note.id] = { x, y: BOARD.y + 38 + i * NOTE_STEP };
		});
	});
	return { columns, notes, hidden };
};

const seatsOf = (scene: Scene) => {
	const heads: Record<string, Point> = {};
	const desks: (Box & { id: string })[] = [];
	let waiting = 0;
	for (const [r, row] of scene.rows.entries())
		for (const [i, ch] of row.entries()) {
			// Desks spread evenly across the room, as the demo's three per row do.
			const x = (ROOM_W * (2 * i + 1)) / (2 * row.length);
			const y = ROW_Y + r * ROW_STEP;
			desks.push({
				id: ch.id,
				x: x - DESK_W / 2,
				y: y - 30,
				w: DESK_W,
				h: DESK_H,
			});
			heads[ch.id] =
				ch.state === "waiting"
					? { x: COFFEE_SPOT.x + waiting++ * WAIT_STEP, y: COFFEE_SPOT.y }
					: { x: x + HEAD_DX, y: y - HEAD_DY };
		}
	return { heads, desks };
};

/** Whether a point falls in a box, edges included: a click on the coffee corner. */
export const inside = (box: Box, p: Point) =>
	p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;

/** The anchors of the room; an empty team still gets its wall and one row of floor. */
export const layoutOf = (scene: Scene): Layout => ({
	width: ROOM_W,
	height: ROW_Y + (Math.max(1, scene.rows.length) - 1) * ROW_STEP + BOTTOM,
	wall: WALL,
	board: BOARD,
	coffee: COFFEE,
	...boardOf(scene),
	...seatsOf(scene),
});
