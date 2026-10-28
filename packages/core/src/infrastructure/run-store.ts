import {
	ChatRequestSchema,
	type Migration,
	PauseReasonSchema,
	RunPreferSchema,
	RunStatusSchema,
	type RunView,
} from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type { Budget } from "../domain/next-step.js";
import {
	type AgentRef,
	type RunSnapshot,
	runMachine,
} from "../domain/run-machine.js";
import { TeamStateSchema } from "../domain/team.js";
import { HANDOFF_MIGRATIONS, handoffs } from "./handoff-store.js";

// The runs and agents tables in the workspace database (docs/07, core-engine tables).

/** core-engine's own schema; the Drizzle tables below mirror it. */
export const RUN_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "001-runs",
		sql: `CREATE TABLE runs (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			template_id TEXT,
			goal TEXT NOT NULL,
			status TEXT NOT NULL,
			pause_reason TEXT,
			autonomy_level INTEGER NOT NULL,
			budget_cloud_requests INTEGER NOT NULL,
			budget_max_hours REAL NOT NULL,
			snapshot TEXT NOT NULL,
			created_at TEXT NOT NULL,
			started_at TEXT,
			ended_at TEXT
		);
		CREATE INDEX runs_status ON runs (status);
		CREATE TABLE agents (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			role_id TEXT NOT NULL,
			provider_id TEXT NOT NULL,
			model_id TEXT NOT NULL,
			requests INTEGER NOT NULL
		);
		CREATE INDEX agents_run ON agents (run_id)`,
	},
	...HANDOFF_MIGRATIONS,
];

const runs = sqliteTable("runs", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id").notNull(),
	templateId: text("template_id"),
	goal: text("goal").notNull(),
	status: text("status").notNull(),
	pauseReason: text("pause_reason"),
	autonomyLevel: integer("autonomy_level").notNull(),
	budgetCloudRequests: integer("budget_cloud_requests").notNull(),
	budgetMaxHours: real("budget_max_hours").notNull(),
	snapshot: text("snapshot").notNull(),
	createdAt: text("created_at").notNull(),
	startedAt: text("started_at"),
	endedAt: text("ended_at"),
});

const agents = sqliteTable("agents", {
	id: text("id").primaryKey(),
	runId: text("run_id").notNull(),
	roleId: text("role_id").notNull(),
	providerId: text("provider_id").notNull(),
	modelId: text("model_id").notNull(),
	requests: integer("requests").notNull(),
});

/** What a run's row holds besides its snapshot. */
export type RunMeta = {
	readonly id: string;
	readonly workspaceId: string;
	readonly autonomyLevel: 0 | 1 | 2 | 3;
	readonly budget: Budget;
	readonly createdAt: string;
};

const text1 = z.string().min(1);
const time = z.number().optional();

// The persisted context, checked on load so a damaged row fails loudly instead of resuming wrong.
const PersistedSchema = z.object({
	value: RunStatusSchema,
	context: z.strictObject({
		goal: text1,
		priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
		messages: z.array(ChatRequestSchema.shape.messages.element),
		turns: z.number().int().nonnegative(),
		// Rows from before the counter hold one attempt, so its turns are its requests.
		requests: z.number().int().nonnegative().optional(),
		activeMs: z.number().nonnegative(),
		since: time,
		checkpointed: z.number().int(),
		agent: z
			.strictObject({
				id: text1,
				roleId: text1.optional(),
				providerId: text1,
				modelId: text1,
			})
			.optional(),
		pause: z
			.strictObject({
				reason: PauseReasonSchema,
				resumesAt: z.string().optional(),
			})
			.optional(),
		summary: z.string().optional(),
		error: z.strictObject({ code: text1, message: z.string() }).optional(),
		startedAt: time,
		endedAt: time,
		team: TeamStateSchema.optional(),
		task: text1.optional(),
		review: text1.optional(),
		clarify: text1.optional(),
		tainted: z.boolean().optional(),
		brief: z.string().optional(),
		workspace: z.string().optional(),
		prefer: RunPreferSchema.optional(),
		preferRevision: z.number().int().nonnegative().optional(),
	}),
});

const iso = (ms: number | undefined) =>
	ms === undefined ? null : new Date(ms).toISOString();

const rowOf = (meta: RunMeta, s: RunSnapshot) => ({
	workspaceId: meta.workspaceId,
	templateId: s.context.team?.template.metadata.id ?? null,
	goal: s.context.goal,
	status: s.value,
	pauseReason: s.value === "paused" ? (s.context.pause?.reason ?? null) : null,
	autonomyLevel: meta.autonomyLevel,
	budgetCloudRequests: meta.budget.cloudRequests,
	budgetMaxHours: meta.budget.maxHours,
	snapshot: JSON.stringify(runMachine.getPersistedSnapshot(s)),
	createdAt: meta.createdAt,
	startedAt: iso(s.context.startedAt),
	endedAt: iso(s.context.endedAt),
});

type Row = typeof runs.$inferSelect;

const Level = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const viewOf = (r: Row): RunView => {
	const { autonomyLevel, budget } = metaOf(r);
	return {
		id: r.id,
		workspaceId: r.workspaceId,
		templateId: r.templateId,
		goal: r.goal,
		status: RunStatusSchema.parse(r.status),
		...(r.pauseReason
			? { pauseReason: PauseReasonSchema.parse(r.pauseReason) }
			: {}),
		autonomyLevel,
		budget,
		createdAt: r.createdAt,
		...(r.startedAt ? { startedAt: r.startedAt } : {}),
		...(r.endedAt ? { endedAt: r.endedAt } : {}),
	};
};

const metaOf = (r: Row): RunMeta => ({
	id: r.id,
	workspaceId: r.workspaceId,
	autonomyLevel: Level.parse(r.autonomyLevel),
	budget: { cloudRequests: r.budgetCloudRequests, maxHours: r.budgetMaxHours },
	createdAt: r.createdAt,
});

/** A snapshot read back from its JSON; throws on a damaged row. */
export const loadSnapshot = (json: string): RunSnapshot => {
	const p = PersistedSchema.parse(JSON.parse(json));
	const requests = p.context.requests ?? p.context.turns;
	return runMachine.resolveState({
		value: p.value,
		context: { ...p.context, requests },
	});
};

type Orm = ReturnType<typeof drizzle>;

/** Writes the agent's row with its model and request count. */
const saveAgent = (
	tx: Pick<Orm, "insert">,
	runId: string,
	agent: AgentRef,
	requests: number,
) => {
	const values = {
		runId,
		roleId: agent.roleId ?? "assistant",
		providerId: agent.providerId,
		modelId: agent.modelId,
		requests,
	};
	tx.insert(agents)
		.values({ id: agent.id, ...values })
		.onConflictDoUpdate({ target: agents.id, set: values })
		.run();
};

/** Writes the run's row after a transition, and its agent's row in the same transaction. */
const save = (orm: Orm, meta: RunMeta, s: RunSnapshot) => {
	const values = rowOf(meta, s);
	const { agent, turns } = s.context;
	orm.transaction((tx) => {
		tx.insert(runs)
			.values({ id: meta.id, ...values })
			.onConflictDoUpdate({ target: runs.id, set: values })
			.run();
		if (agent) saveAgent(tx, meta.id, agent, turns);
	});
};

const load = (orm: Orm, id: string) => {
	const r = orm.select().from(runs).where(eq(runs.id, id)).get();
	return r && { meta: metaOf(r), snapshot: loadSnapshot(r.snapshot) };
};

/** Ends a run whose snapshot cannot be read; the snapshot stays for inspection. */
const markFailed = (orm: Orm, id: string, endedAt: string) => {
	orm
		.update(runs)
		.set({ status: "failed", pauseReason: null, endedAt })
		.where(eq(runs.id, id))
		.run();
};

/** One run or all runs, newest first. */
const list = (orm: Orm, id?: string): RunView[] =>
	orm
		.select()
		.from(runs)
		.where(id === undefined ? undefined : eq(runs.id, id))
		.orderBy(desc(runs.createdAt), desc(sql`rowid`))
		.all()
		.map(viewOf);

/** Runs an earlier process left queued or running. */
// Runs that ended before `iso`; an ISO 8601 time sorts as text.
const endedBefore = (orm: Orm, iso: string) =>
	orm
		.select({ id: runs.id })
		.from(runs)
		.where(and(isNotNull(runs.endedAt), lt(runs.endedAt, iso)))
		.all()
		.map((r) => r.id);

const unfinished = (orm: Orm) =>
	orm
		.select({ id: runs.id })
		.from(runs)
		.where(inArray(runs.status, ["queued", "running"]))
		.all()
		.map((r) => r.id);

// The run's own handoffs go with it; one another run accepted names that run, which keeps it (ADR-143).
const remove = (orm: Orm, id: string) =>
	orm.transaction((tx) => {
		tx.delete(agents).where(eq(agents.runId, id)).run();
		tx.delete(handoffs).where(eq(handoffs.runId, id)).run();
		tx.delete(runs).where(eq(runs.id, id)).run();
	});

/** Reads and writes runs and agents rows. */
export const createRunStore = (db: BetterSqlite3.Database) => {
	const orm = drizzle(db);
	return {
		save: (meta: RunMeta, s: RunSnapshot) => save(orm, meta, s),
		load: (id: string) => load(orm, id),
		markFailed: (id: string, endedAt: string) => markFailed(orm, id, endedAt),
		list: (id?: string) => list(orm, id),
		unfinished: () => unfinished(orm),
		endedBefore: (iso: string) => endedBefore(orm, iso),
		/** Deletes the run's row, its agents and its own handoffs (ADR-143). */
		remove: (id: string) => remove(orm, id),
	};
};

/** The store of one workspace database. */
export type RunStore = ReturnType<typeof createRunStore>;
