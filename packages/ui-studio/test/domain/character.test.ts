import { describe, expect, it } from "vitest";
import { characterOf, lookOf } from "../../src/domain/character.js";
import { PEOPLE } from "../../src/domain/palette.js";
import type { Primitive } from "../../src/domain/primitive.js";
import type { Character } from "../../src/domain/scene.js";
import { shade } from "../../src/domain/sky.js";

// A character's look and pose (docs/13, Characters; ADR-070): seeded by its role, a still pose that is
// seated or standing, with the demo's accessories.

const HEAD = { x: 300, y: 200 };
const ch = (
	roleId: string,
	state: Character["state"] = "idle",
	id = roleId,
): Character => ({ id, roleId, count: 1, state });
// A role id whose look has the accessory: the seed decides, so the test looks one up.
const roleWith = (accessory: string) => {
	for (let i = 0; i < 500; i++)
		if (lookOf(`role${i}`).accessory === accessory) return `role${i}`;
	throw new Error(accessory);
};
const rects = (p: Primitive[], w: number, h: number) =>
	p.filter((x) => x.kind === "rect" && x.w === w && x.h === h);
const circles = (p: Primitive[], r: number) =>
	p.filter((x) => x.kind === "circle" && x.r === r);
// The horizontal positions a shape sits at: its anchor, or every vertex of a polygon.
const xsOf = (p: Primitive): number[] => {
	if (p.kind === "poly") return p.points.filter((_, i) => i % 2 === 0);
	return "x" in p ? [p.x] : [];
};
const arcs = (p: Primitive[]) => p.filter((x) => x.kind === "arc");

describe("lookOf", () => {
	it("is the same for a role every time, and from the demo's sets", () => {
		const look = lookOf("developer");
		expect(lookOf("developer")).toEqual(look);
		expect(PEOPLE.bodies).toContain(look.body);
		expect(PEOPLE.hairs).toContain(look.hair);
		expect(PEOPLE.skins).toContain(look.skin);
		expect(PEOPLE.accessories).toContain(look.accessory);
	});

	it("tells roles apart, so seven roles do not look alike", () => {
		const roles = [
			"lead",
			"designer",
			"developer",
			"tester",
			"pm",
			"artist",
			"writer",
		];
		const looks = new Set(roles.map((r) => JSON.stringify(lookOf(r))));
		expect(looks.size).toBeGreaterThanOrEqual(5);
	});

	it("looks the same for every agent of a role", () => {
		const a = characterOf(ch("dev", "idle", "agent-1"), HEAD, true);
		const b = characterOf(ch("dev", "idle", "agent-2"), HEAD, true);
		expect(a).toEqual(b);
	});
});

describe("characterOf", () => {
	it("draws a seated idle character with sleeves, a smile and no legs", () => {
		const p = characterOf(ch("dev"), HEAD, true);
		expect(rects(p, 7, 17)).toHaveLength(2);
		expect(rects(p, 7, 15)).toEqual([]);
		const smile = arcs(p).find((x) => x.kind === "arc" && x.r === 3);
		expect(smile).toBeDefined();
		const look = lookOf("dev");
		expect(circles(p, 16)).toEqual([
			expect.objectContaining({ x: HEAD.x, y: HEAD.y, fill: look.skin }),
		]);
		expect(rects(p, 28, 27)[0]).toMatchObject({
			x: HEAD.x - 14,
			y: HEAD.y + 14,
			fill: look.body,
		});
	});

	it("puts a typing character's hands forward and takes its sleeves off", () => {
		const p = characterOf(ch("dev", "working"), HEAD, true);
		expect(rects(p, 7, 17)).toEqual([]);
		const hands = circles(p, 4.5);
		expect(hands).toHaveLength(2);
		for (const h of hands) expect(h).toMatchObject({ y: HEAD.y + 14 + 12 });
	});

	it("stands a waiting character on legs with a flat mouth", () => {
		const p = characterOf(ch("dev", "waiting"), HEAD, false);
		expect(rects(p, 7, 15)).toHaveLength(2);
		expect(
			p.find((x) => x.kind === "ellipse" && x.rx === 15 && x.ry === 5),
		).toBeDefined();
		expect(arcs(p).some((x) => x.kind === "arc" && x.r === 3)).toBe(false);
		expect(p.some((x) => x.kind === "line" && x.width === 1.8)).toBe(true);
	});

	it("draws the hood behind the body, then the body, the head and the hair", () => {
		const p = characterOf(ch(roleWith("hood")), HEAD, true);
		const at = (pred: (x: Primitive) => boolean) => p.findIndex(pred);
		const hood = at((x) => x.kind === "circle" && x.r === 19);
		const body = at((x) => x.kind === "rect" && x.w === 28 && x.h === 27);
		const head = at((x) => x.kind === "circle" && x.r === 16);
		const hair = at((x) => x.kind === "poly");
		expect(hood).toBeGreaterThanOrEqual(0);
		expect(hood).toBeLessThan(body);
		expect(body).toBeLessThan(head);
		expect(head).toBeLessThan(hair);
		const look = lookOf(roleWith("hood"));
		expect(p[hood]).toMatchObject({ fill: shade(look.body, -22) });
	});

	it("gives each accessory its own mark", () => {
		const of = (a: string, seated = true) =>
			characterOf(ch(roleWith(a)), HEAD, seated);
		expect(
			arcs(of("glasses")).filter((x) => x.kind === "arc" && x.r === 4.6),
		).toHaveLength(2);
		expect(
			arcs(of("headset")).some((x) => x.kind === "arc" && x.r === 18.5),
		).toBe(true);
		expect(
			of("beret").some((x) => x.kind === "poly" && x.fill === PEOPLE.beret),
		).toBe(true);
		expect(circles(of("beret"), 2.5)).toHaveLength(1);
		expect(
			of("pencil").some((x) => x.kind === "poly" && x.fill === PEOPLE.pencil),
		).toBe(true);
	});

	it("carries the clipboard only while standing", () => {
		const clip = (seated: boolean) =>
			characterOf(ch(roleWith("clip")), HEAD, seated).some(
				(x) => x.kind === "rect" && x.fill === PEOPLE.clipBoard,
			);
		expect(clip(false)).toBe(true);
		expect(clip(true)).toBe(false);
	});

	it("keeps every shape within 40 px of the head sideways, so characters do not spill over the room", () => {
		const cases = PEOPLE.accessories.flatMap((a) =>
			(["idle", "working", "waiting"] as const).flatMap((state) =>
				[true, false].map((seated) =>
					characterOf(ch(roleWith(a), state), HEAD, seated),
				),
			),
		);
		for (const p of cases.flat())
			for (const x of xsOf(p)) expect(Math.abs(x - HEAD.x)).toBeLessThan(40);
	});
});
