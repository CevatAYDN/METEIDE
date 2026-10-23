import { describe, expect, it } from "vitest";
import {
	characterMotion,
	characterOf,
	lookOf,
} from "../../src/domain/character.js";
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

	it("takes a typing character's sleeves off and leaves its hands to the motion layer", () => {
		const p = characterOf(ch("dev", "working"), HEAD, true);
		expect(rects(p, 7, 17)).toEqual([]);
		expect(circles(p, 4.5)).toEqual([]);
		expect(circles(p, 4)).toEqual([]);
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

describe("characterMotion", () => {
	const motion = (state: Character["state"], t: number, seated = true) =>
		characterMotion(ch("dev", state), HEAD, seated, t);
	const eyes = (t: number) =>
		motion("idle", t).filter((x) => x.kind === "ellipse");

	it("opens two eyes at the face and closes them for a moment every 4.2 seconds", () => {
		expect(eyes(1.5)).toHaveLength(2);
		for (const e of eyes(1.5))
			expect(e).toMatchObject({
				rx: 2.2,
				ry: 2.8,
				fill: PEOPLE.eye,
				y: HEAD.y + 3,
			});
		// Each character has its own phase, so look for a moment all of 4.2 seconds holds a blink.
		const closed = Array.from({ length: 420 }, (_, i) => i / 100).filter((t) =>
			eyes(t).some((e) => e.kind === "ellipse" && e.ry < 1),
		);
		expect(closed.length).toBeGreaterThan(5);
		expect(closed.length).toBeLessThan(25);
	});

	it("types with two hands forward that move against each other, only while seated and working", () => {
		const hands = (t: number) =>
			motion("working", t).filter((x) => x.kind === "circle");
		expect(hands(0)).toHaveLength(2);
		for (const h of hands(0))
			expect(h).toMatchObject({ r: 4.5, fill: lookOf("dev").skin });
		const ys = (t: number) =>
			hands(t).map((h) => (h.kind === "circle" ? h.y : 0));
		expect(ys(0)).not.toEqual(ys(0.05));
		const [l, r] = ys(0.1);
		expect((l ?? 0) - (HEAD.y + 26)).toBeCloseTo(
			-((r ?? 0) - (HEAD.y + 26)),
			6,
		);
		expect(motion("idle", 0).filter((x) => x.kind === "circle")).toEqual([]);
		expect(
			motion("working", 0, false).filter((x) => x.kind === "circle"),
		).toEqual([]);
	});

	it("gives two characters different phases, so they do not blink in step", () => {
		const closedAt = (id: string) =>
			Array.from({ length: 420 }, (_, i) => i / 100).find((t) =>
				characterMotion({ ...ch("dev"), id }, HEAD, true, t).some(
					(x) => x.kind === "ellipse" && x.ry < 1,
				),
			);
		expect(closedAt("agent-a")).not.toBe(closedAt("agent-b"));
	});
});
