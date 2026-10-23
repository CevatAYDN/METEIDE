import { describe, expect, it } from "vitest";
import { inside, layoutOf } from "../../src/domain/layout.js";
import type { Character, Scene } from "../../src/domain/scene.js";

// The room's anchors by id: what the painter and the effects share.

const ch = (id: string, state: Character["state"] = "idle"): Character => ({
	id,
	roleId: id,
	count: 1,
	state,
});
const scene = (rows: Character[][], todo: string[] = []): Scene => ({
	rows,
	notes: {
		todo: todo.map((id) => ({ id, title: id })),
		in_progress: [],
		done: [],
	},
});

describe("the room's layout", () => {
	it("gives every character a desk and a head, and a waiting one its head in the coffee corner", () => {
		const l = layoutOf(scene([[ch("a"), ch("b", "waiting")]]), 900);
		expect(l.desks.map((d) => d.id)).toEqual(["a", "b"]);
		const coffee = l.coffee;
		const b = l.heads.b;
		expect(b && b.x >= coffee.x && b.x <= coffee.x + coffee.w).toBe(true);
		const a = l.heads.a;
		const desk = l.desks[0];
		expect(a && desk && a.x === desk.x + desk.w / 2).toBe(true);
	});

	it("anchors the first five notes of a column by task id, left to right", () => {
		const l = layoutOf(scene([], ["n1", "n2", "n3", "n4", "n5", "n6"]), 900);
		expect(Object.keys(l.notes)).toEqual(["n1", "n2", "n3", "n4", "n5"]);
		expect((l.notes.n2?.x ?? 0) > (l.notes.n1?.x ?? 0)).toBe(true);
		expect(l.columns.todo.x).toBeLessThan(l.columns.done.x);
	});
});

describe("a point in a box", () => {
	it("counts the edges in and a point past them out", () => {
		const box = { x: 10, y: 20, w: 100, h: 50 };
		expect(inside(box, { x: 10, y: 20 })).toBe(true);
		expect(inside(box, { x: 110, y: 70 })).toBe(true);
		expect(inside(box, { x: 111, y: 40 })).toBe(false);
		expect(inside(box, { x: 50, y: 19 })).toBe(false);
	});
});
