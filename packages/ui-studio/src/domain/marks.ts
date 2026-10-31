import type { Point } from "./layout.js";
import { MARK, STATE } from "./palette.js";
import { type Primitive, rect, type Shape } from "./primitive.js";
import type { Character } from "./scene.js";

// What a character's state adds over the room (docs/13): its name, the count badge of a group, and
// the icon of its state at the head's right: thinking dots in a bubble, a clock while it waits for
// quota with its countdown below, a spinner while it works with its tool named above.
// The dots and the spinner move (marksMotion); the bubble, the clock and the pills stand still.

const pill = (head: Point, dy: number, text: string): Primitive => ({
	kind: "label",
	x: head.x,
	y: head.y + dy,
	text,
	fill: STATE.label,
	ink: STATE.ink,
	size: 12,
	maxWidth: 140,
});

const bubble = (x: number, y: number): Primitive[] => [
	// The border is a rounded rectangle a pixel larger behind the white one.
	rect([x - 13, y - 10, 34, 20], 10, MARK.bubbleEdge),
	rect([x - 12, y - 9, 32, 18], 9, MARK.bubble),
];

const clock = (x: number, y: number): Primitive[] => [
	{ kind: "circle", x, y, r: 10, fill: MARK.clock },
	{
		kind: "line",
		x1: x,
		y1: y,
		x2: x,
		y2: y - 6,
		stroke: MARK.clockHand,
		width: 1.8,
	},
	{
		kind: "line",
		x1: x,
		y1: y,
		x2: x + 4.5,
		y2: y + 2,
		stroke: MARK.clockHand,
		width: 1.8,
	},
];

const stateIcon = (state: Character["state"], head: Point): Primitive[] => {
	const x = head.x + 30;
	const y = head.y - 14;
	if (state === "thinking") return bubble(x, y);
	if (state === "waiting") return clock(x, y);
	return [];
};

/**
 * What moves in a character's marks at `t` seconds: the dots of a thinking bubble ride a wave, and the
 * spinner of a working one turns.
 */
export const marksMotion = (ch: Character, head: Point, t: number): Shape[] => {
	const x = head.x + 30;
	const y = head.y - 14;
	if (ch.state === "thinking")
		return [0, 1, 2].map(
			(i): Shape => ({
				kind: "circle",
				x: x - 3 + i * 8,
				y: y + Math.sin(t * 7 - i * 0.8) * 2.5,
				r: 2.4,
				fill: MARK.dots,
			}),
		);
	if (ch.state === "working")
		return [
			{
				kind: "arc",
				x,
				y,
				r: 6,
				start: t * 6,
				end: t * 6 + Math.PI * 1.3,
				stroke: MARK.spinner,
				width: 2.6,
			},
		];
	return [];
};

/** The marks over a character at `head`; `until` is the countdown text of a character that waits, `name` its words. */
export const marksOf = (
	ch: Character,
	head: Point,
	until?: string,
	name = ch.roleId,
): Primitive[] => [
	pill(head, -41, name),
	...(ch.count > 1
		? [
				{
					kind: "label",
					x: head.x + 22,
					y: head.y - 22,
					text: String(ch.count),
					fill: MARK.badge,
					ink: MARK.badgeInk,
					size: 11,
				} as const,
			]
		: []),
	...stateIcon(ch.state, head),
	...(ch.state === "working" && ch.tool ? [pill(head, -62, ch.tool)] : []),
	...(ch.state === "waiting" && until ? [pill(head, 66, until)] : []),
];
