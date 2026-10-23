import type { Point } from "./layout.js";
import { PEOPLE } from "./palette.js";
import { type Primitive, rect } from "./primitive.js";
import type { Character } from "./scene.js";
import { seedOf } from "./seed.js";
import { shade } from "./sky.js";

// A character of the demo (docs/prototypes/studio-view.html; ADR-070) as primitives, from its head
// outward: body, arms, head, hair, face and accessory. A role keeps one look in every run: its colours
// and accessory are picked by its id from the demo's six (events carry no role kind yet, docs/13), so
// two agents of a role look alike and seven roles do not collapse into six identical sets.
// shortcut: a still pose facing left, as the demo seats and stands its people; blinking, bobbing,
// walking and typing hands wait for the idle-motion slice.

/** The accessory a role wears. */
export type Accessory = (typeof PEOPLE.accessories)[number];

/** What a role looks like. */
export type Look = {
	readonly body: string;
	readonly hair: string;
	readonly skin: string;
	readonly accessory: Accessory;
};

const pick = <T>(items: readonly T[], i: number): T =>
	items[i % items.length] as T;

/** A role's look: the body, the hair with its skin, and the accessory come from independent parts of its seed. */
export const lookOf = (roleId: string): Look => {
	const h = seedOf(roleId);
	const pair = (h >>> 3) % PEOPLE.hairs.length;
	return {
		body: pick(PEOPLE.bodies, h),
		hair: pick(PEOPLE.hairs, pair),
		skin: pick(PEOPLE.skins, pair),
		accessory: pick(PEOPLE.accessories, h >>> 6),
	};
};

// A rectangle turned about a point: a shape cannot be rotated in place.
const turned = (
	origin: Point,
	angle: number,
	[x, y, w, h]: readonly [number, number, number, number],
	fill: string,
): Primitive => {
	const corners = [x, y, x + w, y, x + w, y + h, x, y + h];
	const points: number[] = [];
	for (let i = 0; i < corners.length; i += 2) {
		const px = corners[i] ?? 0;
		const py = corners[i + 1] ?? 0;
		points.push(
			origin.x + px * Math.cos(angle) - py * Math.sin(angle),
			origin.y + px * Math.sin(angle) + py * Math.cos(angle),
		);
	}
	return { kind: "poly", points, fill };
};

// An ellipse turned about its own centre.
const tilted = (
	c: Point,
	radii: readonly [number, number],
	angle: number,
	fill: string,
): Primitive => {
	const points: number[] = [];
	for (let k = 0; k < 20; k++) {
		const t = (k / 20) * Math.PI * 2;
		const lx = radii[0] * Math.cos(t);
		const ly = radii[1] * Math.sin(t);
		points.push(
			c.x + lx * Math.cos(angle) - ly * Math.sin(angle),
			c.y + lx * Math.sin(angle) + ly * Math.cos(angle),
		);
	}
	return { kind: "poly", points, fill };
};

// A stroke along a circle from one angle to another; `ink` is its colour and width.
const arc = (
	c: Point,
	r: number,
	span: readonly [number, number],
	ink: readonly [string, number],
): Primitive => ({
	kind: "arc",
	x: c.x,
	y: c.y,
	r,
	start: span[0],
	end: span[1],
	stroke: ink[0],
	width: ink[1],
});

// The demo's hair: the top half of a disc whose lower edge is the fringe's swoop.
const hair = (head: Point, fill: string): Primitive => {
	const points: number[] = [];
	for (let k = 0; k <= 12; k++) {
		const a = Math.PI + (k / 12) * Math.PI;
		points.push(head.x + 17 * Math.cos(a), head.y - 1 + 17 * Math.sin(a));
	}
	points.push(
		head.x + 9,
		head.y - 7.25,
		head.x + 1,
		head.y - 10,
		head.x - 8.5,
		head.y - 5.75,
	);
	return { kind: "poly", points, fill };
};

// Every character faces left, as the demo seats and stands its people.
const FACING = -3;

// A character that waits has a flat mouth, the others smile.
const mouth = (head: Point, waiting: boolean): Primitive =>
	waiting
		? {
				kind: "line",
				x1: head.x - 3 + FACING,
				y1: head.y + 10,
				x2: head.x + 3 + FACING,
				y2: head.y + 10,
				stroke: PEOPLE.mouth,
				width: 1.8,
			}
		: arc(
				{ x: head.x + FACING, y: head.y + 7 },
				3,
				[0.2 * Math.PI, 0.8 * Math.PI],
				[PEOPLE.mouth, 1.8],
			);

const face = (head: Point, waiting: boolean): Primitive[] => {
	const eye = (dx: number): Primitive => ({
		kind: "ellipse",
		x: head.x + dx + FACING,
		y: head.y + 3,
		rx: 2.2,
		ry: 2.8,
		fill: PEOPLE.eye,
	});
	const cheek = (dx: number): Primitive => ({
		kind: "circle",
		x: head.x + dx + FACING * 0.5,
		y: head.y + 8,
		r: 2.6,
		fill: PEOPLE.cheek,
	});
	return [eye(-5), eye(5), cheek(-9), cheek(9), mouth(head, waiting)];
};

// What a role wears on its head or holds beside it; a hood sits behind the body and a clipboard is
// carried only while standing, so neither is here.
const WORN: Record<
	Exclude<Accessory, "hood" | "clip">,
	(head: Point) => Primitive[]
> = {
	glasses: (head) =>
		[-5, 5].map((dx) =>
			arc(
				{ x: head.x + dx + FACING, y: head.y + 3 },
				4.6,
				[0, Math.PI * 2],
				[PEOPLE.glasses, 1.6],
			),
		),
	beret: (head) => [
		tilted({ x: head.x - 3, y: head.y - 14 }, [17, 7], -0.25, PEOPLE.beret),
		{
			kind: "circle",
			x: head.x - 4,
			y: head.y - 21,
			r: 2.5,
			fill: PEOPLE.beret,
		},
	],
	headset: (head) => [
		arc(
			{ x: head.x, y: head.y - 1 },
			18.5,
			[Math.PI * 1.05, Math.PI * 1.95],
			[PEOPLE.headset, 3],
		),
		rect([head.x - 22, head.y - 4, 6, 11], 3, PEOPLE.headset),
		rect([head.x + 16, head.y - 4, 6, 11], 3, PEOPLE.headset),
	],
	pencil: (head) => {
		const at = { x: head.x + 15, y: head.y - 7 };
		return [
			turned(at, 0.6, [-2, -9, 4, 16], PEOPLE.pencil),
			turned(at, 0.6, [-2, 5, 4, 3], PEOPLE.pencilTip),
		];
	},
};

const accessoryOf = (a: Accessory, head: Point, standing: boolean) => {
	if (a === "hood") return [];
	if (a === "clip")
		return standing
			? [
					rect([head.x - 27, head.y + 20, 12, 16], 2, PEOPLE.clipBoard),
					rect([head.x - 25, head.y + 23, 8, 11], 1, PEOPLE.clipPaper),
				]
			: [];
	return WORN[a](head);
};

// The shadow and legs of a character that stands, with its feet at `feet`.
const legs = (x: number, feet: number): Primitive[] => [
	{ kind: "ellipse", x, y: feet + 2, rx: 15, ry: 5, fill: PEOPLE.shadow },
	rect([x - 9, feet - 15, 7, 15], 3, PEOPLE.legs),
	rect([x + 2, feet - 15, 7, 15], 3, PEOPLE.legs),
];

// The body from the sleeves to the hands: a typing character has no sleeves and its hands forward.
const torso = (
	x: number,
	bt: number,
	look: Look,
	typing: boolean,
): Primitive[] => {
	const sleeve = shade(look.body, -14);
	const hand = (dx: number, dy: number, r: number): Primitive => ({
		kind: "circle",
		x: x + dx,
		y: bt + dy,
		r,
		fill: look.skin,
	});
	return [
		...(typing
			? []
			: [
					rect([x - 20, bt + 5, 7, 17], 3.5, sleeve),
					rect([x + 13, bt + 5, 7, 17], 3.5, sleeve),
				]),
		rect([x - 14, bt, 28, 27], 11, look.body),
		rect([x - 4, bt + 2, 8, 6], 3, PEOPLE.collar),
		...(typing
			? [hand(-15, 12, 4.5), hand(7, 12, 4.5)]
			: [hand(-16.5, 23, 4), hand(16.5, 23, 4)]),
	];
};

/**
 * A character at its `head`: seated at a desk (drawn between its chair and its desk, so the desk hides
 * its lower body) or standing, as at the coffee corner while it waits for quota.
 */
export const characterOf = (
	ch: Character,
	head: Point,
	seated: boolean,
): Primitive[] => {
	const look = lookOf(ch.roleId);
	const bt = head.y + 14;
	return [
		...(seated ? [] : legs(head.x, head.y + 54)),
		...(look.accessory === "hood"
			? [
					{
						kind: "circle",
						x: head.x,
						y: bt - 12,
						r: 19,
						fill: shade(look.body, -22),
					} as const,
				]
			: []),
		...torso(head.x, bt, look, seated && ch.state === "working"),
		{ kind: "circle", x: head.x, y: head.y, r: 16, fill: look.skin },
		hair(head, look.hair),
		...face(head, ch.state === "waiting"),
		...accessoryOf(look.accessory, head, !seated),
	];
};
