import { ROOM_W } from "../defaults.js";
import type { Layout, Point } from "./layout.js";
import { BOARD, COFFEE, DESK, ROOM } from "./palette.js";
import { type Primitive, rect } from "./primitive.js";
import type { Note, Scene } from "./scene.js";
import { seedOf } from "./seed.js";

// The cozy office of the approved demo as primitives (ADR-070): the wall and floor, the board with
// its notes, the coffee corner, and each desk with its chair, monitor and lamp, at the demo's
// coordinates. The window, clock, shelf and plants are in props.ts; the characters are drawn by paint.ts.

/** The words the room writes, in the user's language. */
export type RoomLabels = {
	readonly todo: string;
	readonly inProgress: string;
	readonly done: string;
	readonly coffee: string;
	readonly vault: string;
};

// A dashed line as its dashes: the stage draws solid strokes only.
const dashes = (
	from: readonly [number, number],
	to: readonly [number, number],
	stroke: string,
	width: number,
): Primitive[] => {
	const [x1, y1] = from;
	const [x2, y2] = to;
	const n = Math.floor(Math.hypot(x2 - x1, y2 - y1) / 8);
	return Array.from({ length: n }, (_, i): Primitive => {
		const at = (t: number) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
		const [ax = 0, ay = 0] = at(i / n);
		const [bx = 0, by = 0] = at((i + 0.5) / n);
		return { kind: "line", x1: ax, y1: ay, x2: bx, y2: by, stroke, width };
	});
};

const planks = (wall: number, height: number): Primitive[] => {
	const out: Primitive[] = [];
	for (let y = wall, row = 0; y < height; y += 36, row++) {
		out.push(
			rect([0, y, ROOM_W, 36], 0, row % 2 ? ROOM.plankDark : ROOM.plankLight),
		);
		out.push(rect([0, y, ROOM_W, 1.5], 0, ROOM.seam));
		for (let x = (row % 2) * 90; x < ROOM_W; x += 180)
			out.push(rect([x, y, 1.5, 36], 0, ROOM.seam));
	}
	return out;
};

const rug = (): Primitive[] => {
	const stitch: Primitive[] = Array.from({ length: 24 }, (_, i) => {
		const a = (i / 24) * Math.PI * 2;
		const b = a + Math.PI / 24;
		return {
			kind: "line",
			x1: 640 + Math.cos(a) * 228,
			y1: 450 + Math.sin(a) * 47,
			x2: 640 + Math.cos(b) * 228,
			y2: 450 + Math.sin(b) * 47,
			stroke: ROOM.rugStitch,
			width: 2,
		};
	});
	return [
		{ kind: "ellipse", x: 640, y: 450, rx: 262, ry: 62, fill: ROOM.rugOuter },
		{ kind: "ellipse", x: 640, y: 450, rx: 246, ry: 54, fill: ROOM.rugInner },
		...stitch,
	];
};

/** The wall with its stripes and trim, the planked floor, the rug and the window's light. */
export const roomShell = (l: Layout): Primitive[] => [
	// The floor first, as wide and tall as the room: the stage sizes the canvas from it.
	rect([0, 0, ROOM_W, l.height], 0, ROOM.floor),
	rect([0, 0, ROOM_W, l.wall], 0, ROOM.wall),
	...Array.from({ length: Math.ceil(ROOM_W / 44) }, (_, i) =>
		rect([i * 44, 0, 20, l.wall - 18], 0, ROOM.stripe),
	),
	rect([0, l.wall - 18, ROOM_W, 18], 0, ROOM.trim),
	rect([0, l.wall - 4, ROOM_W, 4], 0, ROOM.trimDark),
	...planks(l.wall, l.height),
	...rug(),
	{
		kind: "poly",
		points: [566, l.wall, 774, l.wall, 940, 480, 592, 480],
		fill: ROOM.beam,
	},
];

// A note's colour from its task id, so a note keeps it as it moves between columns.
const tint = (id: string) =>
	BOARD.notes[seedOf(id) % BOARD.notes.length] ?? BOARD.notes[0];

// A note's pin; a blocked task's is large, with a "!" (docs/13, `task.status.changed` to `blocked`).
const pinOf = (note: Note, p: Point): Primitive[] =>
	note.blocked
		? [
				{ kind: "circle", x: p.x + 52, y: p.y + 1, r: 6, fill: BOARD.pin },
				{
					kind: "text",
					x: p.x + 50,
					y: p.y - 5,
					text: "!",
					fill: BOARD.pinMark,
					size: 10,
					weight: 800,
				},
			]
		: [{ kind: "circle", x: p.x + 52, y: p.y + 1, r: 2.8, fill: BOARD.pin }];

const notesOf = (scene: Scene, l: Layout): Primitive[] =>
	Object.values(scene.notes)
		.flat()
		.flatMap((note) => {
			const p = l.notes[note.id];
			if (!p) return [];
			return [
				rect([p.x + 2, p.y + 2, 104, 22], 3, BOARD.shadow),
				rect([p.x, p.y, 104, 22], 3, tint(note.id)),
				{
					kind: "text",
					x: p.x + 7,
					y: p.y + 3,
					text: note.title,
					fill: BOARD.noteInk,
					size: 12,
					weight: 600,
					maxWidth: 92,
				},
				...pinOf(note, p),
			];
		});

const columnsOf = (l: Layout, labels: RoomLabels): Primitive[] => {
	const titles = {
		todo: labels.todo,
		in_progress: labels.inProgress,
		done: labels.done,
	};
	return (["todo", "in_progress", "done"] as const).flatMap((column, k) => {
		const { x, y } = l.columns[column];
		const more = l.hidden[column];
		return [
			rect([x, y, 105, 20], 6, BOARD.header),
			{
				kind: "text",
				x: x + 8,
				y: y + 1,
				text: titles[column],
				fill: BOARD.ink,
				size: 13,
				weight: 700,
				maxWidth: 78,
			},
			...(k < 2
				? dashes(
						[x + 112, y + 2],
						[x + 112, l.board.y + l.board.h - 12],
						BOARD.divider,
						1.5,
					)
				: []),
			...(more > 0
				? [
						{
							kind: "label",
							// On the header's right end: the column's notes fill the cork below.
							x: x + 98,
							y: y - 6,
							text: `+${more}`,
							fill: BOARD.badge,
							ink: BOARD.badgeInk,
							size: 11,
						} as const,
					]
				: []),
		];
	});
};

/** The wall board: its frame and cork, a header per column, the shown notes and a "+N" for the rest. */
export const board = (
	scene: Scene,
	l: Layout,
	labels: RoomLabels,
): Primitive[] => {
	const { x, y, w, h } = l.board;
	const specks = Array.from({ length: 80 }, (_, i) =>
		rect(
			[
				x + 10 + ((i * 47) % (w - 20)),
				y + 10 + ((i * 29) % (h - 20)),
				1.6,
				1.6,
			],
			0,
			BOARD.speck,
		),
	);
	return [
		rect([x, y, w, h], 8, BOARD.frame),
		rect([x + 6, y + 6, w - 12, h - 12], 5, BOARD.cork),
		...specks,
		...columnsOf(l, labels),
		...notesOf(scene, l),
	];
};

/** The coffee corner: a counter, the machine with its cup, a jar and a sign. */
export const coffee = (labels: RoomLabels): Primitive[] => {
	const x = 826;
	const y = 118;
	return [
		rect([x, y, 98, 88], 6, COFFEE.counter),
		rect([x, y, 98, 10], 6, COFFEE.top),
		rect([x + 8, y + 22, 38, 56], 4, COFFEE.door),
		rect([x + 52, y + 22, 38, 56], 4, COFFEE.door),
		{ kind: "circle", x: x + 40, y: y + 50, r: 2.2, fill: COFFEE.knob },
		{ kind: "circle", x: x + 58, y: y + 50, r: 2.2, fill: COFFEE.knob },
		rect([x + 18, y - 36, 60, 38], 7, COFFEE.machine),
		rect([x + 26, y - 30, 44, 12], 3, COFFEE.panel),
		{ kind: "circle", x: x + 70, y: y - 24, r: 3, fill: COFFEE.light },
		rect([x + 40, y - 12, 16, 12], 3, COFFEE.cup),
		rect([x + 82, y - 18, 12, 18], 3, COFFEE.jar),
		rect([x + 84, y - 22, 8, 5], 2, COFFEE.lid),
		{
			kind: "label",
			x: x + 49,
			y: y - 62,
			text: labels.coffee,
			fill: COFFEE.sign,
			ink: COFFEE.signInk,
			size: 12,
			maxWidth: 110,
		},
	];
};

/** A desk's chair, behind its character; `x`, `y` are the desk top's centre. */
export const chair = (x: number, y: number): Primitive[] => [
	rect([x + 4, y - 52, 36, 34], 10, DESK.chair),
	rect([x + 8, y - 48, 28, 6], 4, DESK.chairTop),
];

const lamp = (x: number, y: number): Primitive[] => [
	{ kind: "ellipse", x: x + 60, y: y - 24, rx: 10, ry: 4, fill: DESK.stand },
	{
		kind: "line",
		x1: x + 60,
		y1: y - 24,
		x2: x + 54,
		y2: y - 56,
		stroke: DESK.stand,
		width: 3,
	},
	{
		kind: "line",
		x1: x + 54,
		y1: y - 56,
		x2: x + 63,
		y2: y - 63,
		stroke: DESK.stand,
		width: 3,
	},
	{
		kind: "poly",
		points: [x + 55, y - 70, x + 74, y - 62, x + 65, y - 53],
		fill: DESK.lamp,
	},
	rect([x + 42, y - 27, 10, 11], 3, DESK.mug),
];

/** A desk in front of its character, with its monitor and lamp; `screen` is what the monitor shows, dark when empty. */
export const desk = (
	x: number,
	y: number,
	screen: readonly Primitive[] = [],
): Primitive[] => [
	{ kind: "ellipse", x, y: y + 38, rx: 88, ry: 9, fill: DESK.shadow },
	rect([x - 78, y - 30, 156, 42], 9, DESK.top),
	rect([x - 78, y - 30, 156, 9], 9, DESK.edge),
	rect([x - 74, y + 8, 148, 26], 6, DESK.front),
	rect([x - 52, y + 18, 30, 4], 2, DESK.handle),
	rect([x + 22, y + 18, 30, 4], 2, DESK.handle),
	rect([x - 41, y - 40, 10, 12], 2, DESK.stand),
	rect([x - 52, y - 31, 32, 5], 2, DESK.stand),
	rect([x - 67, y - 82, 64, 46], 7, DESK.bezel),
	rect([x - 62, y - 77, 54, 36], 0, DESK.screen),
	...screen,
	{
		kind: "poly",
		points: [x - 62, y - 77, x - 42, y - 77, x - 58, y - 41, x - 62, y - 41],
		fill: DESK.glare,
	},
	...lamp(x, y),
];
