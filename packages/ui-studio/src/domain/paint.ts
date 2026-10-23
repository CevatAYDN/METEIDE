import { characterOf } from "./character.js";
import type { EffectColour } from "./effects.js";
import { type Layout, layoutOf } from "./layout.js";
import { marksOf } from "./marks.js";
import { EFFECT } from "./palette.js";
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
import type { Scene } from "./scene.js";

// The studio room as primitives the stage draws, in the room's own space and the demo's colours
// (ADR-070). The list is in drawing order: the room, then each desk's chair, character and desk, so
// the desk hides a seated body, then the characters at the coffee corner, then the labels and marks
// over everything. Pure, so the room is tested without WebGL; the canvas text comes localized.

/** The words on the canvas, in the user's language. */
export type StageLabels = RoomLabels & {
	/** The countdown under a waiting character, from its quota's reset time. */
	readonly until: (resetsAt: string) => string;
};

const seated = (scene: Scene, l: Layout): Primitive[] =>
	l.desks.flatMap((d) => {
		const x = d.x + d.w / 2;
		const y = d.y + 30;
		const ch = scene.rows.flat().find((c) => c.id === d.id);
		const head = l.heads[d.id];
		const person =
			ch && head && ch.state !== "waiting" ? characterOf(ch, head, true) : [];
		return [...chair(x, y), ...person, ...desk(x, y)];
	});

const overlay = (scene: Scene, l: Layout, labels: StageLabels): Primitive[] =>
	scene.rows.flat().flatMap((ch) => {
		const head = l.heads[ch.id];
		if (!head) return [];
		return marksOf(
			ch,
			head,
			ch.resetsAt ? labels.until(ch.resetsAt) : undefined,
		);
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
			return head ? characterOf(ch, head, false) : [];
		}),
		...overlay(scene, l, labels),
	];
};
