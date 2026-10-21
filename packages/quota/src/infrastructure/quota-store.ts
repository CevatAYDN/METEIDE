import { type Migration, QuotaUnitSchema } from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { and, eq, lt } from "drizzle-orm";
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
import { type Entry, windowLength } from "../domain/windows.js";

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

const MINUTE = 60_000;
const DAY = 86_400_000;
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

/** Reads and writes saved quota state; `now` dates rows and prunes old buckets. */
export const createQuotaStore = (
	db: BetterSqlite3.Database,
	now: () => number,
) => {
	const orm = drizzle(db);
	const saveUsage = (row: UsageRow) => {
		const key = and(
			eq(quotaUsage.providerId, row.providerId),
			eq(quotaUsage.unit, row.unit),
			eq(quotaUsage.scopeKey, row.scopeKey),
		);
		orm.delete(quotaUsage).where(key).run();
		for (const [windowStart, used] of toBuckets(row.entries))
			orm
				.insert(quotaUsage)
				.values({
					providerId: row.providerId,
					unit: row.unit,
					scopeKey: row.scopeKey,
					windowStart,
					used,
				})
				.run();
	};
	const saveLimit = (row: LimitRow) => {
		const values = { ...row, updatedAt: new Date(now()).toISOString() };
		orm
			.insert(quotaLimits)
			.values(values)
			.onConflictDoUpdate({
				target: [quotaLimits.providerId, quotaLimits.unit],
				set: {
					limit: row.limit,
					source: row.source,
					updatedAt: values.updatedAt,
				},
			})
			.run();
	};
	return {
		/** Saved usage newer than the longest window, and learned limits. */
		load(): { usage: UsageRow[]; limits: LimitRow[] } {
			const oldest = now() - (SLIDING_MONTH_DAYS + 1) * DAY;
			orm.delete(quotaUsage).where(lt(quotaUsage.windowStart, oldest)).run();
			const usage = groupUsage(orm.select().from(quotaUsage).all());
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
		},
		/** Writes changed day and month usage and learned limits in one transaction. */
		save(dirty: { usage: readonly UsageRow[]; limits: readonly LimitRow[] }) {
			db.transaction(() => {
				for (const row of dirty.usage.filter(persisted)) saveUsage(row);
				for (const row of dirty.limits) saveLimit(row);
			})();
		},
	};
};

/** Saved quota state. */
export type QuotaStore = ReturnType<typeof createQuotaStore>;
