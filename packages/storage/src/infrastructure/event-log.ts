import {
	type BrokenEvent,
	EVENT_TYPES,
	err,
	type MeteEvent,
	type Migration,
	parseEvent,
	type Result,
	type RunEvents,
} from "@mete/contracts";
import type { Disposable, EventBus, Logger } from "@mete/kernel";
import { EVENT_PAYLOAD_MAX_BYTES, EVENT_RETENTION_DAYS } from "../defaults.js";
import { capPayload, isCutPayload } from "../domain/payload-cap.js";
import type { Db } from "./sqlite.js";

// The events table from docs/07-domain-model-and-events.md (Event envelope).

/** Storage's own schema in the workspace database. */
export const EVENT_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "001-events",
		sql: `CREATE TABLE events (
			seq INTEGER PRIMARY KEY,
			id TEXT NOT NULL UNIQUE,
			type TEXT NOT NULL,
			ts TEXT NOT NULL,
			schema INTEGER NOT NULL,
			workspace_id TEXT NOT NULL,
			run_id TEXT,
			task_id TEXT,
			agent_id TEXT,
			source TEXT NOT NULL,
			payload TEXT NOT NULL
		);
		CREATE INDEX events_run_seq ON events (run_id, seq);
		CREATE INDEX events_type_seq ON events (type, seq);`,
	},
];

// The bus has no catch-all pattern, so storage listens once per catalog domain.
const DOMAINS = [...new Set(EVENT_TYPES.map((t) => t.split(".")[0]))];

/**
 * Inserts every published catalog event; a failed insert throws to the bus error sink. An event
 * already stored (same id) is not stored twice. A run.removed deletes its run's events instead
 * and is not kept itself (ADR-143). A payload whose JSON exceeds EVENT_PAYLOAD_MAX_BYTES is
 * stored cut with a marker, warned once per capture, and the live event is untouched.
 */
export const captureEvents = (
	db: Db,
	events: EventBus,
	warn: Logger["warn"],
): Disposable[] => {
	const insert = db.prepare(`INSERT OR IGNORE INTO events
		(id, type, ts, schema, workspace_id, run_id, task_id, agent_id, source, payload)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
	const removeRun = db.prepare("DELETE FROM events WHERE run_id = ?");
	let warned = false;
	const storedPayload = (e: MeteEvent) => {
		const capped = capPayload(e.payload, EVENT_PAYLOAD_MAX_BYTES);
		if (capped.cut && !warned) {
			warned = true;
			warn(
				{ eventId: e.id, type: e.type, maxBytes: EVENT_PAYLOAD_MAX_BYTES },
				"event payload exceeds the stored size; stored cut, it cannot be replayed whole",
			);
		}
		return capped.json;
	};
	const write = (e: MeteEvent) => {
		if (e.type === "run.removed") {
			if (e.runId) removeRun.run(e.runId);
			return;
		}
		insert.run(
			e.id,
			e.type,
			e.ts,
			e.schema,
			e.workspaceId,
			e.runId ?? null,
			e.taskId ?? null,
			e.agentId ?? null,
			e.source,
			storedPayload(e),
		);
	};
	return DOMAINS.map((d) => events.subscribe(`${d}.*`, write));
};

/** Deletes events older than the retention (ISO timestamps sort by time). */
export const pruneEvents = (db: Db, now: number) => {
	const cutoff = new Date(
		now - EVENT_RETENTION_DAYS * 86_400_000,
	).toISOString();
	db.prepare("DELETE FROM events WHERE ts < ?").run(cutoff);
};

type Row = {
	seq: number;
	id: string;
	type: string;
	ts: string;
	schema: number;
	workspace_id: string;
	run_id: string | null;
	task_id: string | null;
	agent_id: string | null;
	source: string;
	payload: string;
};

const envelopeOf = (r: Row) => ({
	id: r.id,
	type: r.type,
	ts: r.ts,
	schema: r.schema,
	workspaceId: r.workspace_id,
	...(r.run_id ? { runId: r.run_id } : {}),
	...(r.task_id ? { taskId: r.task_id } : {}),
	...(r.agent_id ? { agentId: r.agent_id } : {}),
	source: r.source,
	payload: JSON.parse(r.payload) as unknown,
});

// One row as an event, or why it cannot be replayed: a cut payload, JSON that no longer parses,
// or a payload its schema refuses.
const parseRow = (row: Row): Result<MeteEvent, string> => {
	let envelope: ReturnType<typeof envelopeOf>;
	try {
		envelope = envelopeOf(row);
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
	if (isCutPayload(envelope.payload))
		return err(
			`payload cut: ${envelope.payload.bytes} bytes exceed ${EVENT_PAYLOAD_MAX_BYTES}`,
		);
	const parsed = parseEvent(envelope);
	return parsed.ok ? parsed : err(parsed.error.issues.join("; "));
};

/**
 * One run's persisted events in replay order, each checked against its schema again. A row whose
 * payload was stored cut is reported as broken with its original size, never replayed.
 */
export const readRunEvents = (db: Db, runId: string): RunEvents => {
	const rows = db
		.prepare("SELECT * FROM events WHERE run_id = ? ORDER BY seq")
		.all(runId) as Row[];
	const events: MeteEvent[] = [];
	const broken: BrokenEvent[] = [];
	for (const row of rows) {
		const parsed = parseRow(row);
		if (parsed.ok) events.push(parsed.value);
		else broken.push({ seq: row.seq, issues: parsed.error });
	}
	return { events, broken };
};
