import { CLOCK, PLANT, SHELF, WINDOW } from "./palette.js";
import { type Primitive, rect } from "./primitive.js";
import { mix, type Rgb, rgb, type Sky, skyOf } from "./sky.js";

// The wall's props of the demo (docs/prototypes/studio-view.html; ADR-070) as primitives: the window
// with the user's time of day, the clock, the Vault shelf and the plants, at the demo's coordinates.
// shortcut: a still picture drawn at the moment of rendering. The twinkle of the stars, the drift of
// the clouds, the sway of the leaves and the clock's moving hands come with the idle-motion slice,
// and the sun's and the moon's glow is left out (the stage has no radial gradient).

const PANE = { x: 564, y: 34, w: 212, h: 112 } as const;
const BANDS = 8;

const clamp = (v: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, v));

// The sky's top and bottom colours: day to night, with the warm tint of sunrise and sunset over both.
const skyColours = (sky: Sky): [Rgb, Rgb] => [
	mix(
		mix(WINDOW.skyDayTop, WINDOW.skyNightTop, sky.n),
		WINDOW.skyWarmTop,
		sky.warm * 0.75,
	),
	mix(
		mix(WINDOW.skyDayBottom, WINDOW.skyNightBottom, sky.n),
		WINDOW.skyWarmBottom,
		sky.warm * 0.75,
	),
];

// The stage draws flat fills, so the sky is bands from its top colour to its bottom colour.
const bandsOf = (top: Rgb, bottom: Rgb): Primitive[] =>
	Array.from({ length: BANDS }, (_, i) =>
		rect(
			[PANE.x, PANE.y + (i * PANE.h) / BANDS, PANE.w, PANE.h / BANDS],
			0,
			rgb(mix(top, bottom, i / (BANDS - 1))),
		),
	);

const starsOf = (n: number): Primitive[] =>
	n <= 0.05
		? []
		: Array.from({ length: 24 }, (_, i) =>
				rect(
					[
						PANE.x + ((i * 53.7) % PANE.w),
						PANE.y + ((i * 31.3) % (PANE.h * 0.6)),
						1.7,
						1.7,
					],
					0,
					rgb(WINDOW.star, n * (0.5 + 0.5 * Math.sin(i * 1.7)) * 0.9),
				),
			);

// The sun crosses the pane from the day's start to its 56%; the moon from 52% to the end. Their
// centres stay a radius inside the pane, since nothing clips what the stage draws.
const sunAndMoon = (sky: Sky, [top, bottom]: [Rgb, Rgb]): Primitive[] => {
	const out: Primitive[] = [];
	const dp = sky.p / 0.56;
	if (dp <= 1.05 && sky.n < 0.98)
		out.push({
			kind: "circle",
			x: clamp(PANE.x + dp * PANE.w, PANE.x + 10, PANE.x + PANE.w - 10),
			y:
				PANE.y +
				PANE.h * 0.88 -
				Math.sin(Math.PI * clamp(dp, 0, 1)) * PANE.h * 0.62,
			r: 10,
			fill: rgb(WINDOW.sun, 1 - sky.n),
		});
	if (sky.p > 0.52 && sky.n > 0.02) {
		const mp = (sky.p - 0.52) / 0.48;
		const x = clamp(PANE.x + mp * PANE.w, PANE.x + 8, PANE.x + PANE.w - 12);
		const y = PANE.y + PANE.h * 0.8 - Math.sin(Math.PI * mp) * PANE.h * 0.55;
		out.push(
			{ kind: "circle", x, y, r: 8, fill: rgb(WINDOW.moon, sky.n) },
			// A disc of the sky over the moon's edge makes the crescent.
			{
				kind: "circle",
				x: x + 4,
				y: y - 2,
				r: 7,
				fill: rgb(mix(top, bottom, 0.35), sky.n),
			},
		);
	}
	return out;
};

const cloudsOf = (sky: Sky): Primitive[] =>
	[0, 1, 2].flatMap((i) => {
		const x = PANE.x + 30 + i * 70;
		const y = PANE.y + 18 + i * 15;
		const fill = rgb(
			mix(WINDOW.cloud, WINDOW.cloudWarm, sky.warm),
			0.85 * (1 - sky.n * 0.65),
		);
		return [
			{ kind: "ellipse", x, y, rx: 16, ry: 7, fill },
			{ kind: "ellipse", x: x + 11, y: y - 4, rx: 11, ry: 7, fill },
			{ kind: "ellipse", x: x - 10, y: y - 2, rx: 9, ry: 6, fill },
		] as const;
	});

// The demo's ten buildings as [left, width, height] from the pane's left and bottom; a lit window
// shows in the dark.
const BUILDINGS: readonly (readonly [number, number, number])[] = [
	[0, 18, 34],
	[20, 14, 50],
	[36, 22, 28],
	[60, 16, 60],
	[78, 26, 40],
	[106, 14, 30],
	[122, 20, 54],
	[144, 24, 36],
	[170, 16, 46],
	[188, 24, 30],
];

const litWindows = (
	[left, width, height]: readonly [number, number, number],
	i: number,
	night: number,
): Primitive[] => {
	const out: Primitive[] = [];
	const bottom = PANE.y + PANE.h;
	for (let wy = bottom - height + 5; wy < bottom - 4; wy += 7)
		for (let wx = PANE.x + left + 3; wx < PANE.x + left + width - 3; wx += 6)
			if ((wx * 7 + wy * 13 + i) % 5 < 2)
				out.push(
					rect(
						[wx, wy, 2.4, 2.8],
						0,
						rgb(WINDOW.lit, Math.min(1, (night - 0.3) * 1.2)),
					),
				);
	return out;
};

const skyline = (night: number): Primitive[] => {
	const fill = rgb(mix(WINDOW.buildingDay, WINDOW.buildingNight, night));
	return BUILDINGS.flatMap((b, i) => [
		rect([PANE.x + b[0], PANE.y + PANE.h - b[2], b[1], b[2]], 0, fill),
		...(night > 0.3 ? litWindows(b, i, night) : []),
	]);
};

/** The window: the sky of the user's local time with its sun or moon, stars, clouds and skyline, in its frame on a sill. */
export const windowOf = (sky: Sky): Primitive[] => {
	const colours = skyColours(sky);
	const x = 556;
	const y = 26;
	const w = 228;
	const h = 128;
	return [
		rect([x - 6, y - 6, w + 12, h + 12], 10, WINDOW.frame),
		...bandsOf(...colours),
		...starsOf(sky.n),
		...sunAndMoon(sky, colours),
		...cloudsOf(sky),
		...skyline(sky.n),
		rect([x + w / 2 - 3, y, 6, h], 0, WINDOW.frame),
		rect([x, y + h / 2 - 3, w, 6], 0, WINDOW.frame),
		rect([x - 14, y + h + 4, w + 28, 9], 3, WINDOW.sill),
		rect([x + 16, y + h - 8, 14, 13], 3, WINDOW.pot),
		{
			kind: "ellipse",
			x: x + 23,
			y: y + h - 16,
			rx: 5,
			ry: 10,
			fill: WINDOW.sprout,
		},
	];
};

/** The wall clock at 505, 74 showing the user's local time. */
export const clockOf = (now: Date): Primitive[] => {
	const x = 505;
	const y = 74;
	const hours = now.getHours() + now.getMinutes() / 60;
	const hand = (angle: number, length: number, width: number): Primitive => ({
		kind: "line",
		x1: x,
		y1: y,
		x2: x + Math.cos(angle) * length,
		y2: y + Math.sin(angle) * length,
		stroke: CLOCK.hand,
		width,
	});
	return [
		{ kind: "circle", x, y, r: 24, fill: CLOCK.rim },
		{ kind: "circle", x, y, r: 20, fill: CLOCK.face },
		...Array.from({ length: 12 }, (_, i) => {
			const a = (i / 12) * Math.PI * 2;
			return rect(
				[x + Math.cos(a) * 16 - 1, y + Math.sin(a) * 16 - 1, 2, 2],
				0,
				CLOCK.tick,
			);
		}),
		hand(((hours % 12) / 12) * Math.PI * 2 - Math.PI / 2, 10, 3),
		hand((hours % 1) * Math.PI * 2 - Math.PI / 2, 15, 2),
		{ kind: "circle", x, y, r: 2.4, fill: CLOCK.pin },
	];
};

/**
 * The Vault shelf at 1106, 28: its sign and thirteen books, the demo's seed.
 * shortcut: the books are decoration; they become the vault's notes once `vault.note.saved` is folded
 * into the view model (nothing emits it yet).
 */
export const shelfOf = (vault: string): Primitive[] => {
	const [x, y, w, h] = [1106, 28, 148, 147];
	const boards = [y + 74, y + 110, y + 141];
	const books = SHELF.books.length;
	return [
		rect([x, y, w, h], 6, SHELF.frame),
		rect([x + 6, y + 6, w - 12, h - 12], 4, SHELF.inner),
		{
			kind: "label",
			x: x + 74,
			y: y + 9,
			text: vault,
			fill: SHELF.sign,
			ink: SHELF.signInk,
			size: 12,
		},
		...boards.map((by) => rect([x + 6, by, w - 12, 5], 0, SHELF.frame)),
		...Array.from({ length: 13 }, (_, i) => {
			const board = boards[Math.floor(i / 9)] ?? y;
			const height = 22 + ((i * 7) % 11);
			const bx = x + 12 + (i % 9) * 14;
			return [
				rect(
					[bx, board - height, 11, height],
					2,
					SHELF.books[(i * 3) % books] ?? SHELF.frame,
				),
				rect([bx + 2, board - height + 4, 7, 2], 0, SHELF.spine),
			];
		}).flat(),
	];
};

// A leaf: an ellipse tilted from the pot, as a polygon, since a shape cannot be rotated in place.
const leaf = (o: {
	readonly x: number;
	readonly y: number;
	readonly angle: number;
	readonly length: number;
	readonly width: number;
	readonly fill: string;
}): Primitive => {
	const turn = o.angle + Math.PI / 2;
	const points: number[] = [];
	for (let k = 0; k < 16; k++) {
		const t = (k / 16) * Math.PI * 2;
		const lx = o.width * Math.cos(t);
		const ly = -o.length / 2 + (o.length / 2) * Math.sin(t);
		points.push(
			o.x + lx * Math.cos(turn) - ly * Math.sin(turn),
			o.y + lx * Math.sin(turn) + ly * Math.cos(turn),
		);
	}
	return { kind: "poly", points, fill: o.fill };
};

/** A potted plant standing on `base`, at `scale`: its pot, rim and seven leaves fanned out. */
export const plantOf = (o: {
	readonly x: number;
	readonly base: number;
	readonly scale: number;
}): Primitive[] => {
	const { x, base, scale: s } = o;
	return [
		{
			kind: "poly",
			points: [
				x - 16 * s,
				base - 26 * s,
				x + 16 * s,
				base - 26 * s,
				x + 12 * s,
				base,
				x - 12 * s,
				base,
			],
			fill: PLANT.pot,
		},
		rect([x - 18 * s, base - 31 * s, 36 * s, 7 * s], 3, PLANT.rim),
		...Array.from({ length: 7 }, (_, i) =>
			leaf({
				x,
				y: base - 30 * s,
				angle: -Math.PI / 2 + (i - 3) * 0.38,
				length: (38 + (i % 3) * 13) * s,
				width: 7 * s,
				fill: i % 2 ? PLANT.leafLight : PLANT.leafDark,
			}),
		),
	];
};

/** The window, clock, shelf and both plants for a local time. */
export const propsAt = (now: Date, vault: string): Primitive[] => [
	...windowOf(skyOf(now)),
	...clockOf(now),
	...shelfOf(vault),
	...plantOf({ x: 476, base: 206, scale: 1 }),
	...plantOf({ x: 1078, base: 206, scale: 0.9 }),
];
