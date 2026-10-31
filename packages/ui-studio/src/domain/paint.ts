import { ROOM_W } from "../defaults.js";
import { characterMotion, characterOf } from "./character.js";
import type { EffectColour } from "./effects.js";
import { type Layout, layoutOf } from "./layout.js";
import { marksMotion, marksOf } from "./marks.js";
import { EFFECT, ROOM } from "./palette.js";
import {
	type Moment,
	type Painted,
	type Primitive,
	rect,
	type Shape,
} from "./primitive.js";
import { wallMoving, wallStill } from "./props.js";
import {
	board,
	chair,
	coffee,
	desk,
	type RoomLabels,
	roomShell,
} from "./room.js";
import type { Character, Scene } from "./scene.js";
import { offlineScreen, screenOf, sleepDot } from "./screen.js";
import { seedOf } from "./seed.js";

// The studio room as primitives the stage draws, in the room's own space and the demo's colours
// (ADR-070). The list is in drawing order: the room, then each desk's chair, character and desk, so
// the desk hides a seated body, then the characters at the coffee corner, then the labels and marks
// over everything. Pure, so the room is tested without WebGL; the canvas text comes localized.

/** The words on the canvas, in the user's language. */
export type StageLabels = RoomLabels & {
	/** The countdown under a waiting character, from its quota's reset time. */
	readonly until: (resetsAt: string) => string;
	/** The name of a character that works an attempt of a best-of-N task (ADR-162). */
	readonly attempt: (roleId: string, k: number, n: number) => string;
};

/** A character's name over its head and in the lists beside the room: its role, and its attempt if any. */
export const nameOf = (
	ch: Pick<Character, "roleId" | "attempt">,
	labels: Pick<StageLabels, "attempt">,
): string =>
	ch.attempt
		? labels.attempt(ch.roleId, ch.attempt.k, ch.attempt.n)
		: ch.roleId;

const seated = (scene: Scene, l: Layout): Primitive[] =>
	l.desks.flatMap((d) => {
		const x = d.x + d.w / 2;
		const y = d.y + 30;
		const ch = scene.rows.flat().find((c) => c.id === d.id);
		const head = l.heads[d.id];
		const person =
			ch && head && ch.state !== "waiting" ? characterOf(ch, head, true) : [];
		// The monitor wakes while its character works at the desk; offline, every monitor says so.
		const box = { x: x - 62, y: y - 77 };
		const screen = scene.offline
			? offlineScreen(box)
			: ch?.state === "working"
				? screenOf(ch.tool, box)
				: [];
		return [...chair(x, y), ...person, ...desk(x, y, screen)];
	});

const overlay = (scene: Scene, l: Layout, labels: StageLabels): Primitive[] =>
	scene.rows.flat().flatMap((ch) => {
		const head = l.heads[ch.id];
		if (!head) return [];
		return marksOf(
			ch,
			head,
			ch.resetsAt ? labels.until(ch.resetsAt) : undefined,
			nameOf(ch, labels),
		);
	});

/** The colour of each effect, the demo's. */
export const EFFECT_COLOURS: Readonly<Record<EffectColour, string>> = EFFECT;

// What moves, above everything still (ADR-070): the wall's window, clock and leaves, the dot on each
// dark monitor, then each character's eyes and typing hands and the dots and spinner of its marks, and
// offline the shade over all of it.
const moving = (scene: Scene, l: Layout, at: Moment): Shape[] => [
	...wallMoving(at),
	...l.desks.flatMap((d) => {
		const working = scene.rows
			.flat()
			.some((c) => c.id === d.id && c.state === "working");
		const seed = (seedOf(d.id) % 100) / 10;
		const box = { x: d.x + d.w / 2 - 62, y: d.y + 30 - 77 };
		return working || scene.offline ? [] : [sleepDot(box, seed, at.t)];
	}),
	...scene.rows.flat().flatMap((ch) => {
		const head = l.heads[ch.id];
		if (!head) return [];
		return [
			...characterMotion(ch, head, ch.state !== "waiting", at.t),
			...marksMotion(ch, head, at.t),
		];
	}),
	...(scene.offline
		? [rect([0, 0, ROOM_W, l.height], 0, ROOM.offlineShade)]
		: []),
];

/**
 * The room as two layers (ADR-070): `still` in drawing order, whose first primitive is the floor, as wide
 * and tall as the room, and `moving`, the shapes of a moment, which the stage draws again every frame
 * above the still ones. The window and the clock show the moment's local time.
 */
export const paintScene = (scene: Scene, labels: StageLabels): Painted => {
	const l = layoutOf(scene);
	const waiting = scene.rows.flat().filter((ch) => ch.state === "waiting");
	return {
		still: [
			...roomShell(l),
			...board(scene, l, labels),
			...coffee(labels),
			...wallStill(labels.vault),
			...seated(scene, l),
			...waiting.flatMap((ch) => {
				const head = l.heads[ch.id];
				return head ? characterOf(ch, head, false) : [];
			}),
			...overlay(scene, l, labels),
		],
		moving: (at) => moving(scene, l, at),
	};
};
