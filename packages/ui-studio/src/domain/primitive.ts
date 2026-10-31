// The shapes and text the stage draws, in the room's own space (ADR-070).

/** One thing to draw, in the room's space. */
export type Primitive =
	| {
			readonly kind: "rect";
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
			/** Corner radius; square when absent. */
			readonly r?: number;
			readonly fill: string;
	  }
	| {
			readonly kind: "circle";
			readonly x: number;
			readonly y: number;
			readonly r: number;
			readonly fill: string;
	  }
	| {
			readonly kind: "ellipse";
			readonly x: number;
			readonly y: number;
			readonly rx: number;
			readonly ry: number;
			readonly fill: string;
	  }
	| {
			readonly kind: "poly";
			readonly points: readonly number[];
			readonly fill: string;
	  }
	| {
			readonly kind: "line";
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
			readonly stroke: string;
			readonly width: number;
	  }
	| {
			/** A stroke only, round-capped: the part of a circle from `start` to `end` radians (0 is right, clockwise). */
			readonly kind: "arc";
			readonly x: number;
			readonly y: number;
			readonly r: number;
			readonly start: number;
			readonly end: number;
			readonly stroke: string;
			readonly width: number;
	  }
	| {
			readonly kind: "text";
			readonly x: number;
			readonly y: number;
			readonly text: string;
			readonly fill: string;
			readonly size: number;
			readonly weight?: number;
			/** The stage cuts longer text with "…". */
			readonly maxWidth?: number;
	  }
	| {
			/** Text in a pill the stage sizes to it, centred on `x`, its top at `y`. */
			readonly kind: "label";
			readonly x: number;
			readonly y: number;
			readonly text: string;
			readonly fill: string;
			readonly ink: string;
			readonly size: number;
			readonly maxWidth?: number;
	  };

/** A shape: anything but text, which the stage lays out and cannot redraw every frame. */
export type Shape = Exclude<Primitive, { kind: "text" | "label" }>;

/** A moment of the room's life: the user's clock and seconds since the stage started. */
export type Moment = { readonly now: Date; readonly t: number };

/**
 * The room as the stage draws it: `still` once per change, `moving` again every frame (the window, the
 * clock, leaves, eyes, dots), as shapes only, above everything still (ADR-070).
 */
export type Painted = {
	readonly still: readonly Primitive[];
	readonly moving: (at: Moment) => readonly Shape[];
};

/** A rectangle from its box, corner radius and fill. */
export const rect = (
	[x, y, w, h]: readonly [number, number, number, number],
	r: number,
	fill: string,
): Shape => ({ kind: "rect", x, y, w, h, r, fill });

// Segments per rounded corner of a polygon: smooth at the few pixels a corner takes on screen.
const ARC_STEPS = 6;

/** A rectangle whose bottom corners are rounded at `r` and whose top corners stay square, as a polygon. */
export const bottomRounded = (
	[x, y, w, h]: readonly [number, number, number, number],
	r: number,
	fill: string,
): Shape => {
	// A quarter circle around (cx, y + h - r), clockwise on screen from the angle `from`.
	const arc = (cx: number, from: number) =>
		Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
			const a = from + (i / ARC_STEPS) * (Math.PI / 2);
			return [cx + r * Math.cos(a), y + h - r + r * Math.sin(a)];
		}).flat();
	return {
		kind: "poly",
		points: [x, y, x + w, y, ...arc(x + w - r, 0), ...arc(x + r, Math.PI / 2)],
		fill,
	};
};
