import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createHandoffStore } from "../../src/infrastructure/handoff-store.js";
import { RUN_MIGRATIONS } from "../../src/infrastructure/run-store.js";

const open = () => {
	const db = new Database(":memory:");
	for (const m of RUN_MIGRATIONS) db.exec(m.sql);
	return { db, store: createHandoffStore(db) };
};

const handoff = (id: string, createdAt: string) => ({
	id,
	workspaceId: "ws",
	runId: `run-${id}`,
	body: `# Handoff ${id}`,
	createdAt,
});

describe("handoff store", () => {
	it("keeps one open handoff: a new one expires the older", () => {
		const { db, store } = open();
		store.write(handoff("h1", "2026-10-22T10:00:00.000Z"));
		store.write(handoff("h2", "2026-10-22T11:00:00.000Z"));
		expect(store.newestOpen("ws")?.id).toBe("h2");
		const states = db
			.prepare("SELECT id, state FROM handoffs ORDER BY id")
			.all();
		expect(states).toEqual([
			{ id: "h1", state: "expired" },
			{ id: "h2", state: "open" },
		]);
	});

	it("accepts an open handoff exactly once", () => {
		const { store } = open();
		store.write(handoff("h1", "2026-10-22T10:00:00.000Z"));
		const h = store.newestOpen("ws");
		if (!h) throw new Error("no handoff");
		expect(store.accept(h, "r2", "2026-10-22T12:00:00.000Z")).toBe(true);
		expect(store.accept(h, "r3", "2026-10-22T12:00:01.000Z")).toBe(false);
		expect(store.newestOpen("ws")).toBeUndefined();
	});
});
