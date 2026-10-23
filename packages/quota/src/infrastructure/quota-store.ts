import { type Migration, QuotaUnitSchema } from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { and, eq, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { SLIDING_MONTH_DAYS } from "../defaults.js";
import type { LimitRow, UsageRow } from "../domain/pool.js";
import { DAY, type Entry, MINUTE, windowLength } from "../domain/windows.js";

// Day and month usage and learned limits in the global database (docs/09, Quota pool).

/** Quota's own schema; the Drizzle tables below mirror it. */
export const QUOTA_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "001-quota",
		sql: `CREATE TABLE quota_usage (
			provider_id TEXT NOT NULL,
			unit TEXT NOT NULL,
			scope_key TEXT NOT NULL,
			window_start INTEGER NOT NULL,
			used REAL NOT NULL,
			PRIMARY KEY (provider_id, unit, scope_key, window_start)
		);
		CREATE TABLE quota_limits (
			provider_id TEXT NOT NULL,
			unit TEXT NOT NULL,
			"limit" REAL NOT NULL,
			source TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (provider_id, unit)
		)`,
	},
];

const quotaUsage = sqliteTable(
	"quota_usage",
	{
		providerId: text("provider_id").notNull(),
		unit: text("unit").notNull(),
		scopeKey: text("scope_key").notNull(),
		windowStart: integer("window_start").notNull(),
		used: real("used").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.providerId, t.unit, t.scopeKey, t.windowStart] }),
	],
);

const quotaLimits = sqliteTable(
	"quota_limits",
	{
		providerId: text("provider_id").notNull(),
		unit: text("unit").notNull(),
		limit: real("limit").notNull(),
		source: text("source").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.providerId, t.unit] })],
);

const SourceSchema = z.enum(["header", "discovered"]);

// Minute units are counted in memory only.
const persisted = (row: UsageRow) => windowLength(row.unit) > MINUTE;

// Usage is saved in one-minute buckets, so a sliding day still has an opening after a
// restart; a loaded bucket counts at its last millisecond, which never opens early.
const toBuckets = (entries: readonly Entry[]) => {
	const buckets = new Map<number, number>();
	for (const e of entries) {
		const start = Math.floor(e.at / MINUTE) * MINUTE;
		buckets.set(start, (buckets.get(start) ?? 0) + e.amount);
	}
	return buckets;
};

const groupUsage = (
	rows: readonly (typeof quotaUsage.$inferSelect)[],
): UsageRow[] => {
	const groups = new Map<string, UsageRow & { entries: Entry[] }>();
	for (const r of rows) {
		const key = `${r.providerId}\u0000${r.unit}\u0000${r.scopeKey}`;
		const unit = QuotaUnitSchema.parse(r.unit);
		const group = groups.get(key) ?? {
			providerId: r.providerId,
			unit,
			scopeKey: r.scopeKey,
			entries: [],
		};
		group.entries.push({ at: r.windowStart + MINUTE - 1, amount: r.used });
		groups.set(key, group);
	}
	return [...groups.values()];
};

type Orm = ReturnType<typeof drizzle>;
type Saved = { usage: UsageRow[]; limits: LimitRow[] };

// What this process loaded or last wrote per usage row and bucket (ADR-074): a save adds only the
// growth since then, so another process's calls in the same buckets stay.
type Baseline = Map<string, Map<number, number>>;

const baselineKey = (row: {
	readonly providerId: string;
	readonly unit: string;
	readonly scopeKey: string;
}) => `${row.providerId}\u0000${row.unit}\u0000${row.scopeKey}`;

const saveUsage = (orm: Orm, row: UsageRow, baseline: Baseline) => {
	const { providerId, unit, scopeKey } = row;
	const at = (windowStart: number) =>
		and(
			eq(quotaUsage.providerId, providerId),
			eq(quotaUsage.unit, unit),
			eq(quotaUsage.scopeKey, scopeKey),
			eq(quotaUsage.windowStart, windowStart),
		);
	const mine = toBuckets(row.entries);
	const known = baseline.get(baselineKey(row)) ?? new Map<number, number>();
	// A bucket this process held and no longer does ended by a reset or by age: it ends for everyone.
	for (const windowStart of known.keys())
		if (!mine.has(windowStart))
			orm.delete(quotaUsage).where(at(windowStart)).run();
	for (const [windowStart, used] of mine) {
		const growth = used - (known.get(windowStart) ?? 0);
		if (growth > 0)
			orm
				.insert(quotaUsage)
				.values({ providerId, unit, scopeKey, windowStart, used: growth })
				.onConflictDoUpdate({
					target: [
						quotaUsage.providerId,
						quotaUsage.unit,
						quotaUsage.scopeKey,
						quotaUsage.windowStart,
					],
					set: { used: sql`${quotaUsage.used} + ${growth}` },
				})
				.run();
		else if (growth < 0)
			orm
				.update(quotaUsage)
				.set({ used: sql`max(0, ${quotaUsage.used} + ${growth})` })
				.where(at(windowStart))
				.run();
	}
	return mine;
};

const saveLimit = (orm: Orm, row: LimitRow, updatedAt: string) => {
	orm
		.insert(quotaLimits)
		.values({ ...row, updatedAt })
		.onConflictDoUpdate({
			target: [quotaLimits.providerId, quotaLimits.unit],
			set: { limit: row.limit, source: row.source, updatedAt },
		})
		.run();
};

/** Saved usage newer than the longest window, and learned limits. */
const load = (orm: Orm, now: number, baseline: Baseline): Saved => {
	const oldest = now - (SLIDING_MONTH_DAYS + 1) * DAY;
	orm.delete(quotaUsage).where(lt(quotaUsage.windowStart, oldest)).run();
	const rows = orm.select().from(quotaUsage).all();
	baseline.clear();
	for (const r of rows) {
		const key = baselineKey(r);
		const buckets = baseline.get(key) ?? new Map<number, number>();
		buckets.set(r.windowStart, r.used);
		baseline.set(key, buckets);
	}
	const usage = groupUsage(rows);
	const limits = orm
		.select()
		.from(quotaLimits)
		.all()
		.map((r) => ({
			providerId: r.providerId,
			unit: QuotaUnitSchema.parse(r.unit),
			limit: r.limit,
			source: SourceSchema.parse(r.source),
		}));
	return { usage, limits };
};

/** Reads and writes saved quota state; `now` dates rows and prunes old buckets. */
export const createQuotaStore = (
	db: BetterSqlite3.Database,
	now: () => number,
) => {
	const orm = drizzle(db);
	const baseline: Baseline = new Map();
	return {
		load: () => load(orm, now(), baseline),
		/**
		 * Adds this process's growth in day and month usage, and writes learned limits, in one
		 * transaction (ADR-074).
		 */
		save(dirty: { usage: readonly UsageRow[]; limits: readonly LimitRow[] }) {
			const updatedAt = new Date(now()).toISOString();
			const written = new Map<string, Map<number, number>>();
			db.transaction(() => {
				for (const row of dirty.usage.filter(persisted))
					written.set(baselineKey(row), saveUsage(orm, row, baseline));
				for (const row of dirty.limits) saveLimit(orm, row, updatedAt);
			})();
			for (const [key, buckets] of written) baseline.set(key, buckets);
		},
	};
};

/** Saved quota state. */
export type QuotaStore = ReturnType<typeof createQuotaStore>;
