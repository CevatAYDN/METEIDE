import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	EVENT_MIGRATIONS,
	readRunEvents,
} from "../../src/infrastructure/event-log.js";

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const WS = "3d0176bf-5975-4503-83bb-088326a07ea2";

const insert = (
	db: Database.Database,
	id: string,
	type: string,
	payload: string,
) =>
	db
		.prepare(
			"INSERT INTO events (id, type, ts, schema, workspace_id, run_id, source, payload) VALUES (?, ?, ?, 1, ?, ?, 'core-engine', ?)",
		)
		.run(id, type, "2026-10-22T10:00:00.000Z", WS, RUN, payload);

describe("readRunEvents", () => {
	it("reads a run's events in order and reports rows that no longer parse", () => {
		const db = new Database(":memory:");
		for (const m of EVENT_MIGRATIONS) db.exec(m.sql);
		insert(db, "a1b2c3d4-0000-4000-8000-000000000001", "run.started", "{}");
		insert(
			db,
			"a1b2c3d4-0000-4000-8000-000000000002",
			"run.paused",
			'{"reason":"lost"}',
		);
		insert(
			db,
			"a1b2c3d4-0000-4000-8000-000000000003",
			"run.resumed",
			"not json",
		);
		const { events, broken } = readRunEvents(db, RUN);
		expect(events.map((e) => e.type)).toEqual(["run.started"]);
		expect(broken.map((b) => b.seq)).toEqual([2, 3]);
		expect(broken[0]?.issues).toContain("reason");
	});
});
