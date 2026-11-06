import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { initialTransition, transition } from "xstate";
import { runMachine } from "../../src/domain/run-machine.js";
import {
	createRunStore,
	RUN_MIGRATIONS,
} from "../../src/infrastructure/run-store.js";

it("enumerates all paused IDs without parsing damaged historical metadata or snapshots", () => {
	const db = new Database(":memory:");
	for (const migration of RUN_MIGRATIONS) db.exec(migration.sql);
	const store = createRunStore(db);
	const queued = initialTransition(runMachine, {
		goal: "read",
		priority: 1,
		messages: [],
	})[0];
	const running = transition(runMachine, queued, { type: "START", at: 0 })[0];
	const meta = {
		workspaceId: "ws",
		autonomyLevel: 2 as const,
		budget: { cloudRequests: 1, maxHours: 1 },
		createdAt: "2026-11-07T00:00:00.000Z",
	};
	try {
		for (const reason of ["user", "quota", "network", "approval"] as const) {
			const paused = transition(runMachine, running, {
				type: "PAUSE",
				at: 1,
				reason,
			})[0];
			store.save({ ...meta, id: reason }, paused);
		}
		store.save(
			{ ...meta, id: "history" },
			transition(runMachine, running, {
				type: "COMPLETE",
				at: 1,
				summary: "done",
			})[0],
		);
		db.prepare(
			"UPDATE runs SET autonomy_level = 99, snapshot = 'damaged'",
		).run();
		expect(store.paused().sort()).toEqual([
			"approval",
			"network",
			"quota",
			"user",
		]);
	} finally {
		db.close();
	}
});
