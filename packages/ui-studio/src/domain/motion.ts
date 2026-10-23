import type { Effect, EffectColour } from "./effects.js";

// What the stage animates for an effect (docs/13, Performance and access; ADR-052): a shape that
// starts at one place and ends at another in a time. A burst is twelve particles, never more than
// 300 alive at once; reduced motion plays no particles, moves or jumps, and a mark fades in place.

/** The shape a motion draws: a dot or a short text. */
export type Shape =
	| {
			readonly kind: "dot";
			readonly r: number;
			readonly colour: string;
			readonly alpha: number;
	  }
	| { readonly kind: "text"; readonly text: string; readonly colour: string };

/** One tween: the shape from a place to a place, in milliseconds. */
export type Motion = {
	readonly shape: Shape;
	readonly from: { readonly x: number; readonly y: number };
	readonly to: {
		readonly x: number;
		readonly y: number;
		readonly alpha?: number;
	};
	readonly ms: number;
	/** A particle counts towards the 300 alive at once. */
	readonly particle: boolean;
};

/** At most this many particles are alive at once (13 UI and studio view, Performance and access). */
export const MAX_PARTICLES = 300;
const PER_BURST = 12;

const burst = (
	e: Extract<Effect, { kind: "burst" }>,
	colour: string,
	room: number,
): Motion[] => {
	const n = Math.max(0, Math.min(PER_BURST, room));
	return Array.from({ length: n }, (_, i): Motion => {
		const angle = (i / n) * Math.PI * 2;
		return {
			shape: { kind: "dot", r: 3, colour, alpha: 1 },
			from: e.at,
			to: {
				x: e.at.x + Math.cos(angle) * 36,
				y: e.at.y + Math.sin(angle) * 36,
				alpha: 0,
			},
			ms: 700,
			particle: true,
		};
	});
};

const mark = (
	e: Extract<Effect, { kind: "mark" }>,
	colour: string,
	reduced: boolean,
): Motion => ({
	shape: { kind: "text", text: e.text, colour },
	from: { x: e.at.x - 5, y: e.at.y },
	to: { x: e.at.x - 5, y: reduced ? e.at.y : e.at.y - 14, alpha: 0 },
	ms: 1500,
	particle: false,
});

const move = (
	e: Extract<Effect, { kind: "move" }>,
	colour: string,
): Motion => ({
	shape: {
		kind: "dot",
		r: e.target === "envelope" ? 6 : 10,
		colour,
		alpha: 0.6,
	},
	from: e.from,
	to: e.to,
	ms: 600,
	particle: false,
});

const jump = (e: Extract<Effect, { kind: "jump" }>, colour: string): Motion[] =>
	e.at.map((at) => ({
		shape: { kind: "dot", r: 16, colour, alpha: 1 },
		from: at,
		to: { x: at.x, y: at.y - 14, alpha: 0 },
		ms: 500,
		particle: false,
	}));

type Ctx = {
	readonly colours: Record<EffectColour, string>;
	readonly reduced: boolean;
	/** Particles that may still start. */
	readonly room: number;
};

// The motions of one effect; under reduced motion only a mark plays.
const motionOf = (e: Effect, c: Ctx): Motion[] => {
	if (e.kind === "mark") return [mark(e, c.colours[e.colour], c.reduced)];
	if (c.reduced) return [];
	switch (e.kind) {
		case "burst":
			return burst(e, c.colours[e.colour], c.room);
		case "move":
			return [move(e, c.colours.accent)];
		case "jump":
			return jump(e, c.colours.good);
		default:
			return [];
	}
};

/**
 * The motions of the effects; `alive` is how many particles already play.
 */
export const motionsOf = (
	effects: readonly Effect[],
	colours: Record<EffectColour, string>,
	reduced: boolean,
	alive: number,
): Motion[] =>
	effects.reduce<Motion[]>((out, e) => {
		const room = MAX_PARTICLES - alive - out.filter((m) => m.particle).length;
		out.push(...motionOf(e, { colours, reduced, room }));
		return out;
	}, []);
