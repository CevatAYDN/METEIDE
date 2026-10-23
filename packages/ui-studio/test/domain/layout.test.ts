import { describe, expect, it } from "vitest";
import { characterAt, inside, layoutOf } from "../../src/domain/layout.js";
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
		const l = layoutOf(scene([[ch("a"), ch("b", "waiting")]]));
		expect(l.desks.map((d) => d.id)).toEqual(["a", "b"]);
		const b = l.heads.b;
		expect(b && b.x >= l.coffee.x && b.x <= l.coffee.x + 2 * l.coffee.w).toBe(
			true,
		);
		const a = l.heads.a;
		const desk = l.desks[0];
		// A seated head sits behind its desk, right of the monitor.
		expect(a && desk && a.x > desk.x + desk.w / 2 && a.y < desk.y).toBe(true);
	});

	it("spreads a row's desks across the room's own width, 1280 wide like the demo", () => {
		const l = layoutOf(scene([[ch("a"), ch("b"), ch("c")]]));
		expect(l.width).toBe(1280);
		const centres = l.desks.map((d) => d.x + d.w / 2);
		expect(centres.map(Math.round)).toEqual([213, 640, 1067]);
	});

	it("keeps the wall and one row of floor for a team with no agent yet, and grows with its rows", () => {
		const empty = layoutOf(scene([]));
		const two = layoutOf(scene([[ch("a")], [ch("b")]]));
		expect(empty.height).toBeGreaterThan(empty.wall + 200);
		// Two rows make the demo's 16:9 room.
		expect(two.height).toBe(720);
	});

	it("anchors three notes a column, top to bottom, and counts the rest for a badge", () => {
		const l = layoutOf(scene([], ["n1", "n2", "n3", "n4", "n5"]));
		expect(Object.keys(l.notes)).toEqual(["n1", "n2", "n3"]);
		expect((l.notes.n2?.y ?? 0) > (l.notes.n1?.y ?? 0)).toBe(true);
		expect(l.hidden).toEqual({ todo: 2, in_progress: 0, done: 0 });
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

describe("characterAt", () => {
	const l = layoutOf(scene([[ch("a"), ch("b"), ch("c", "waiting")]]));
	const head = (id: string) => l.heads[id] ?? { x: 0, y: 0 };

	it("finds the character whose head or shoulders a point is on, as the demo's click does", () => {
		const a = head("a");
		expect(characterAt(l, a)).toBe("a");
		expect(characterAt(l, { x: a.x + 20, y: a.y + 50 })).toBe("a");
		expect(characterAt(l, head("c"))).toBe("c");
	});

	it("finds none between two desks, above a head or below the shoulders", () => {
		const a = head("a");
		const b = head("b");
		expect(characterAt(l, { x: (a.x + b.x) / 2, y: a.y })).toBeUndefined();
		expect(characterAt(l, { x: a.x, y: a.y - 30 })).toBeUndefined();
		expect(characterAt(l, { x: a.x, y: a.y + 60 })).toBeUndefined();
	});
});
