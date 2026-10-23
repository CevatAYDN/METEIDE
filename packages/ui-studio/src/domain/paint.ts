import type { EffectColour } from "./effects.js";
import { type Layout, layoutOf, type Point } from "./layout.js";
import { EFFECT, STATE } from "./palette.js";
import type { Primitive } from "./primitive.js";
import { propsAt } from "./props.js";
import {
	board,
	chair,
	coffee,
	desk,
	type RoomLabels,
	roomShell,
} from "./room.js";
import type { Character, Scene } from "./scene.js";

// The studio room as primitives the stage draws, in the room's own space and the demo's colours
// (ADR-070). The list is in drawing order: the room, then each desk's chair, character and desk, so
// the desk hides a seated body, then the characters at the coffee corner, then the labels and marks
// over everything. Pure, so the room is tested without WebGL; the canvas text comes localized.

/** The words on the canvas, in the user's language. */
export type StageLabels = RoomLabels & {
	/** The countdown under a waiting character, from its quota's reset time. */
	readonly until: (resetsAt: string) => string;
};

// shortcut: a character is a disc in its state's colour until the characters of the theme are drawn.
const body = (ch: Character, { x, y }: Point): Primitive => ({
	kind: "circle",
	x,
	y,
	r: 16,
	fill: STATE[ch.state],
});

// What a character's state adds over the room: its name, a count badge, thinking dots, its tool,
// its countdown.
const marks = (ch: Character, { x, y }: Point, until?: string): Primitive[] => {
	const pill = (dy: number, text: string): Primitive => ({
		kind: "label",
		x,
		y: y + dy,
		text,
		fill: STATE.label,
		ink: STATE.ink,
		size: 12,
		maxWidth: 140,
	});
	return [
		pill(-41, ch.roleId),
		...(ch.count > 1
			? [
					{
						kind: "label",
						x: x + 22,
						y: y - 22,
						text: String(ch.count),
						fill: STATE.thinking,
						ink: "#ffffff",
						size: 11,
					} as const,
				]
			: []),
		...(ch.state === "thinking"
			? [-8, 0, 8].map(
					(dx): Primitive => ({
						kind: "circle",
						x: x + 30 + dx,
						y: y - 14,
						r: 2.5,
						fill: STATE.thinking,
					}),
				)
			: []),
		...(ch.state === "working" && ch.tool ? [pill(-62, ch.tool)] : []),
		...(ch.state === "waiting" && until ? [pill(66, until)] : []),
	];
};

const seated = (scene: Scene, l: Layout): Primitive[] =>
	l.desks.flatMap((d) => {
		const x = d.x + d.w / 2;
		const y = d.y + 30;
		const ch = scene.rows.flat().find((c) => c.id === d.id);
		const head = l.heads[d.id];
		const person = ch && head && ch.state !== "waiting" ? [body(ch, head)] : [];
		return [...chair(x, y), ...person, ...desk(x, y)];
	});

const overlay = (scene: Scene, l: Layout, labels: StageLabels): Primitive[] =>
	scene.rows.flat().flatMap((ch) => {
		const head = l.heads[ch.id];
		if (!head) return [];
		return marks(ch, head, ch.resetsAt ? labels.until(ch.resetsAt) : undefined);
	});

/** The colour of each effect, the demo's. */
export const EFFECT_COLOURS: Readonly<Record<EffectColour, string>> = EFFECT;

/**
 * The primitives of the room, in drawing order; the first is the floor, as wide and tall as the room.
 * `now` is the user's local time, which the window and the clock show (ADR-070).
 */
export const paintScene = (
	scene: Scene,
	labels: StageLabels,
	now: Date,
): Primitive[] => {
	const l = layoutOf(scene);
	const waiting = scene.rows.flat().filter((ch) => ch.state === "waiting");
	return [
		...roomShell(l),
		...board(scene, l, labels),
		...coffee(labels),
		...propsAt(now, labels.vault),
		...seated(scene, l),
		...waiting.flatMap((ch) => {
			const head = l.heads[ch.id];
			return head ? [body(ch, head)] : [];
		}),
		...overlay(scene, l, labels),
	];
};
