import {
	type EngineError,
	err,
	type Migration,
	ok,
	type Result,
	RunStatusSchema,
} from "@mete/contracts";
import { asc, eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/better-sqlite3";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type { ThreadIntent, ThreadSaved } from "../domain/thread.js";

type ThreadRun = { readonly id: string; readonly createdAt: string };

/** Additive schema: existing runs are not inferred into conversations (ADR-182). */
export const THREAD_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "003-conversation-threads",
		sql: `CREATE TABLE conversation_threads (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
	CREATE TABLE conversation_turns (
		run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
		conversation_id TEXT NOT NULL REFERENCES conversation_threads(id),
		position INTEGER NOT NULL, predecessor_id TEXT, message TEXT,
		UNIQUE(conversation_id, position)
	);
	CREATE TABLE conversation_receipts (
		request_id TEXT PRIMARY KEY, digest TEXT NOT NULL,
		conversation_id TEXT NOT NULL, run_id TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
	);`,
	},
];

const threads = sqliteTable("conversation_threads", {
	id: text("id").primaryKey(),
	createdAt: text("created_at").notNull(),
});
const threadTurns = sqliteTable("conversation_turns", {
	runId: text("run_id").primaryKey(),
	conversationId: text("conversation_id").notNull(),
	position: integer("position").notNull(),
	predecessorId: text("predecessor_id"),
	message: text("message"),
});
const receipts = sqliteTable(
	"conversation_receipts",
	{
		requestId: text("request_id").notNull(),
		digest: text("digest").notNull(),
		conversationId: text("conversation_id").notNull(),
		runId: text("run_id").notNull(),
		deleted: integer("deleted").notNull(),
	},
	(table) => [primaryKey({ columns: [table.requestId] })],
);

type Orm = Pick<
	ReturnType<typeof drizzle>,
	"select" | "insert" | "update" | "delete" | "transaction" | "get"
>;
type Tx = Parameters<Parameters<Orm["transaction"]>[0]>[0];
const missing = () =>
	err<EngineError>({
		code: "not_found",
		message: "conversation run was removed",
	});

const StoredHead = z.strictObject({
	id: z.string(),
	status: RunStatusSchema,
	templateId: z.string().nullable(),
	createdAt: z.string(),
});
const run = (orm: Orm, id: string) => {
	const row = orm.get(
		sql`SELECT id, status, template_id AS templateId, created_at AS createdAt FROM runs WHERE id = ${id}`,
	);
	return row ? StoredHead.parse(row) : undefined;
};

const receipt = (
	orm: Orm,
	intent: Pick<ThreadIntent, "requestId" | "digest">,
): Result<ThreadSaved, EngineError> | undefined => {
	const row = orm
		.select()
		.from(receipts)
		.where(eq(receipts.requestId, intent.requestId))
		.get();
	if (!row) return undefined;
	if (row.digest !== intent.digest)
		return err({
			code: "bad_input",
			message: "request id belongs to a different intent",
		});
	if (row.deleted || !run(orm, row.runId)) return missing();
	return ok({
		conversationId: row.conversationId,
		runId: row.runId,
		fresh: false,
	});
};

const members = (orm: Orm, id: string) =>
	orm
		.select()
		.from(threadTurns)
		.where(eq(threadTurns.conversationId, id))
		.orderBy(asc(threadTurns.position))
		.all();

const validHead = (
	orm: Orm,
	intent: ThreadIntent,
): Result<undefined, EngineError> => {
	if (!intent.expectedRunId) return ok(undefined);
	const head = run(orm, intent.expectedRunId);
	if (!head) return missing();
	if (head.templateId !== null)
		return err({
			code: "not_supported",
			message: "only single-agent conversations accept replies",
		});
	const prior = members(orm, intent.conversationId ?? "");
	const current = prior.at(-1)?.runId ?? intent.conversationId;
	if (head.status !== "completed" || current !== intent.expectedRunId)
		return err({
			code: "invalid_state",
			status: head.status,
			message: "reply requires the completed current conversation head",
		});
	const membership = orm
		.select()
		.from(threadTurns)
		.where(eq(threadTurns.runId, head.id))
		.get();
	if (membership && membership.conversationId !== intent.conversationId)
		return missing();
	return ok(undefined);
};

const append = (tx: Tx, intent: ThreadIntent, meta: ThreadRun) => {
	const id = intent.conversationId ?? meta.id;
	const prior = members(tx, id);
	if (prior.length === 0 && intent.expectedRunId) {
		tx.insert(threads)
			.values({
				id,
				createdAt: run(tx, intent.expectedRunId)?.createdAt ?? meta.createdAt,
			})
			.run();
		tx.insert(threadTurns)
			.values({ runId: intent.expectedRunId, conversationId: id, position: 0 })
			.run();
	} else if (prior.length === 0) {
		tx.insert(threads).values({ id, createdAt: meta.createdAt }).run();
	}
	const position =
		prior.length > 0
			? (prior.at(-1)?.position ?? 0) + 1
			: intent.expectedRunId
				? 1
				: 0;
	tx.insert(threadTurns)
		.values({
			runId: meta.id,
			conversationId: id,
			position,
			predecessorId: intent.expectedRunId ?? null,
			message: intent.message,
		})
		.run();
	tx.insert(receipts)
		.values({
			requestId: intent.requestId,
			digest: intent.digest,
			conversationId: id,
			runId: meta.id,
			deleted: 0,
		})
		.run();
	return ok({ conversationId: id, runId: meta.id, fresh: true });
};

const remove = (orm: Orm, runId: string) => {
	const membership = orm
		.select()
		.from(threadTurns)
		.where(eq(threadTurns.runId, runId))
		.get();
	orm
		.update(receipts)
		.set({ deleted: 1 })
		.where(eq(receipts.runId, runId))
		.run();
	orm.delete(threadTurns).where(eq(threadTurns.runId, runId)).run();
	if (membership && members(orm, membership.conversationId).length === 0)
		orm.delete(threads).where(eq(threads.id, membership.conversationId)).run();
};

/** Shares the run writer's transaction; linkage cannot be appended after execution starts. */
export const createThreadStore = (orm: Orm) => ({
	receipt: (intent: Pick<ThreadIntent, "requestId" | "digest">) =>
		receipt(orm, intent),
	members: (id: string) => members(orm, id),
	membership: (runId: string) =>
		orm.select().from(threadTurns).where(eq(threadTurns.runId, runId)).get(),
	createdAt: (id: string) =>
		orm.select().from(threads).where(eq(threads.id, id)).get()?.createdAt,
	messages: (id: string) =>
		members(orm, id).flatMap((turn) =>
			turn.message === null ? [] : [turn.message],
		),
	links: () =>
		orm
			.select({
				runId: threadTurns.runId,
				conversationId: threadTurns.conversationId,
				position: threadTurns.position,
			})
			.from(threadTurns)
			.all(),
	remove: (runId: string) => remove(orm, runId),
	commit: (
		intent: ThreadIntent,
		meta: ThreadRun,
		write: (tx: Tx) => void,
	): Result<ThreadSaved, EngineError> =>
		orm.transaction((tx) => {
			const replay = receipt(tx, intent);
			if (replay) return replay;
			const valid = validHead(tx, intent);
			if (!valid.ok) return valid;
			write(tx);
			return append(tx, intent, meta);
		}),
});
