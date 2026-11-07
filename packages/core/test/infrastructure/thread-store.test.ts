import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { initialTransition, transition } from "xstate";
import { runMachine } from "../../src/domain/run-machine.js";
import {
	createRunStore,
	RUN_MIGRATIONS,
} from "../../src/infrastructure/run-store.js";
import { createThreadStore } from "../../src/infrastructure/thread-store.js";

const open = () => {
	const db = new Database(":memory:");
	for (const migration of RUN_MIGRATIONS) db.exec(migration.sql);
	return {
		db,
		runs: createRunStore(db),
		threads: createThreadStore(drizzle(db)),
	};
};

const meta = (id: string) => ({
	id,
	workspaceId: randomUUID(),
	autonomyLevel: 2 as const,
	budget: { cloudRequests: 150, maxHours: 6 },
	createdAt: "2026-11-07T10:00:00.000Z",
});

const snapshot = () => {
	const [queued] = initialTransition(runMachine, {
		goal: "hello",
		priority: 1,
		messages: [],
	});
	const [running] = transition(runMachine, queued, { type: "START", at: 0 });
	return transition(runMachine, running, {
		type: "COMPLETE",
		at: 1,
		summary: "done",
	})[0];
};

describe("thread persistence", () => {
	it("migrates without linking or rewriting existing runs", () => {
		const db = new Database(":memory:");
		for (const migration of RUN_MIGRATIONS.filter(
			(m) => m.id !== "003-conversation-threads",
		))
			db.exec(migration.sql);
		const runs = createRunStore(db);
		const id = randomUUID();
		runs.save(meta(id), snapshot());
		const before = runs.load(id);
		const migration = RUN_MIGRATIONS.find(
			(m) => m.id === "003-conversation-threads",
		);
		if (!migration) throw new Error("migration");
		db.exec(migration.sql);
		expect(runs.load(id)).toEqual(before);
		expect(runs.threads.members(id)).toEqual([]);
		db.close();
	});

	it("adopts only the exact legacy run and reads retained members in append order", () => {
		const { db, runs, threads } = open();
		const first = randomUUID();
		const other = randomUUID();
		const next = randomUUID();
		runs.save(meta(first), snapshot());
		runs.save(meta(other), snapshot());
		const intent = {
			conversationId: first,
			expectedRunId: first,
			requestId: randomUUID(),
			digest: "digest",
			message: "next",
		};
		expect(
			threads.commit(intent, meta(next), (tx) => {
				tx.run(
					sql`INSERT INTO runs SELECT ${next} AS id, workspace_id, template_id, goal, status, pause_reason, autonomy_level, budget_cloud_requests, budget_max_hours, snapshot, created_at, started_at, ended_at FROM runs WHERE id = ${first}`,
				);
			}),
		).toMatchObject({
			ok: true,
			value: { fresh: true, conversationId: first, runId: next },
		});
		expect(threads.members(first).map((m) => m.runId)).toEqual([first, next]);
		expect(threads.members(other)).toEqual([]);
		expect(threads.messages(first)).toEqual(["next"]);
		db.close();
	});
});
