import { describe, expect, it } from "vitest";
import { paths, setup } from "./search-setup.js";

// docs/11, Aging and restore (ADR-173): a cold note is ranked after the warm ones, before the k cut;
// a note the search returns counts one access, at most once per 60 seconds.
const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const note = (type: string, title: string, created: string, body: string) =>
	`---
type: ${type}
title: ${title}
created: ${created}
pinned: false
---

${body}
`;
const pinned = (text: string) => text.replace("pinned: false", "pinned: true");

const clock = () => {
	let t = NOW;
	return { now: () => t, pass: (ms: number) => (t += ms) };
};

const accessesOf = (
	db: { prepare: (s: string) => { get: (p: string) => unknown } },
	path: string,
) =>
	(
		db
			.prepare("SELECT accesses FROM knowledge_access WHERE path = ?")
			.get(path) as { accesses: number } | undefined
	)?.accesses;

describe("aging in knowledge.search@1", () => {
	it("ranks an old lesson after a fresh one that matches worse, and leaves it out under k", async () => {
		const c = clock();
		const s = await setup({ now: c.now });
		await s.note(
			"lessons/old.md",
			note("lesson", "Old", ago(200), "port port port free"),
		);
		await s.note("lessons/new.md", note("lesson", "New", ago(1), "the port"));
		expect(paths(await s.search({ query: "port", k: 1 }))).toEqual([
			"lessons/new.md",
		]);
		expect(paths(await s.search({ query: "port" }))).toEqual([
			"lessons/new.md",
			"lessons/old.md",
		]);
		c.pass(61_000);
		// Found a minute ago, the old lesson is warm again and its better match leads.
		expect(paths(await s.search({ query: "port" }))).toEqual([
			"lessons/old.md",
			"lessons/new.md",
		]);
		await s.close();
	});

	it("never cools a pinned lesson or an old decision", async () => {
		const s = await setup({ now: clock().now });
		await s.note(
			"lessons/pin.md",
			pinned(note("lesson", "Pin", ago(500), "port port port")),
		);
		await s.note(
			"decisions/old.md",
			note("decision", "Dec", ago(900), "port port"),
		);
		await s.note("lessons/new.md", note("lesson", "New", ago(1), "the port"));
		expect(paths(await s.search({ query: "port" }))).toEqual([
			"lessons/pin.md",
			"decisions/old.md",
			"lessons/new.md",
		]);
		await s.close();
	});

	it("counts a returned note once per minute and forgets a deleted note's count", async () => {
		const c = clock();
		const s = await setup({ now: c.now });
		await s.note("lessons/a.md", note("lesson", "A", ago(1), "port"));
		await s.search({ query: "port" });
		c.pass(30_000);
		await s.search({ query: "port" });
		expect(accessesOf(s.db, "lessons/a.md")).toBe(1);
		c.pass(31_000);
		await s.search({ query: "port" });
		expect(accessesOf(s.db, "lessons/a.md")).toBe(2);
		await s.remove("lessons/a.md");
		await s.search({ query: "port" });
		expect(accessesOf(s.db, "lessons/a.md")).toBeUndefined();
		await s.close();
	});
});
