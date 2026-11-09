import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillSnapshot } from "@mete/contracts";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initialTransition } from "xstate";
import { runMachine } from "../../src/domain/run-machine.js";
import { RunSkillStateSchema } from "../../src/domain/skill-state.js";
import {
	createRunStore,
	loadSnapshot,
	RUN_MIGRATIONS,
} from "../../src/infrastructure/run-store.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const runId = id(1);
const owner = { runId, contextId: id(2) };
const snapshot: SkillSnapshot = {
	receiptId: id(3),
	owner,
	inspection: {
		source: {
			sourceId: "a".repeat(64),
			scope: "workspace",
			path: "review/SKILL.md",
		},
		metadata: { name: "review", description: "Review" },
		text: "\ufeffExact retained instructions\r\n",
		sha256: "b".repeat(64),
	},
	revision: 1,
	origin: "explicit",
	loadedAt: "2026-11-09T00:00:00Z",
	payloadSha256: "c".repeat(64),
};
const version = {
	sourceId: snapshot.inspection.source.sourceId,
	sha256: snapshot.inspection.sha256,
	revision: 1,
};
const skills = {
	runId,
	policy: {
		mode: "manual" as const,
		roles: [{ roleId: "assistant", selected: [version] }],
	},
	contexts: [{ owner, roleId: "assistant", snapshots: [snapshot] }],
};
const initial = () =>
	initialTransition(runMachine, {
		goal: "Review",
		priority: 1,
		messages: [],
	})[0];
const saved = (extra: object) => {
	const base = runMachine.getPersistedSnapshot(initial());
	return JSON.stringify({
		...base,
		context: { ...initial().context, ...extra },
	});
};
const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) if (db.open) db.close();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("retained skill state", () => {
	it("retains only an ordered explicit prefix before model-selected snapshots", () => {
		const make = (n: number): SkillSnapshot => ({
			...snapshot,
			receiptId: id(20 + n),
			inspection: {
				...snapshot.inspection,
				source: {
					...snapshot.inspection.source,
					sourceId: n.toString(16).padStart(64, "0"),
				},
			},
		});
		const a = make(1),
			b = make(2),
			model = { ...make(3), origin: "model" as const };
		const selected = [a, b].map((s) => ({
			sourceId: s.inspection.source.sourceId,
			sha256: s.inspection.sha256,
			revision: s.revision,
		}));
		const state = (snapshots: readonly SkillSnapshot[]) => ({
			...skills,
			policy: { mode: "auto", roles: [{ roleId: "assistant", selected }] },
			contexts: [{ owner, roleId: "assistant", snapshots }],
		});
		for (const snapshots of [[a], [a, b], [a, b, model]])
			expect(RunSkillStateSchema.safeParse(state(snapshots)).success).toBe(
				true,
			);
		for (const snapshots of [[b], [b, a], [model], [a, model]]) {
			const invalid = state(snapshots);
			expect(RunSkillStateSchema.safeParse(invalid).success).toBe(false);
			expect(() =>
				loadSnapshot(saved({ skillRuntimeVersion: 1, skills: invalid })),
			).toThrow();
		}
	});

	it("does not fabricate an S2 marker or content when reading a legacy snapshot", () => {
		const context = loadSnapshot(saved({})).context;
		expect(context.skillRuntimeVersion).toBeUndefined();
		expect(context.skills).toBeUndefined();
		expect(context.skillBlock).toBeUndefined();
	});

	it("keeps an omitted marker omitted so inventory guards, not parsing, judge legacy", () => {
		const context = loadSnapshot(saved({ skills })).context;
		expect(context.skillRuntimeVersion).toBeUndefined();
		expect(context.skills).toEqual(skills);
	});

	it("persists complete bodies separately from messages across real SQLite reopen", () => {
		const root = mkdtempSync(join(tmpdir(), "mete-skills-state-"));
		roots.push(root);
		const file = join(root, "workspace.db");
		const db = new Database(file);
		databases.push(db);
		for (const migration of RUN_MIGRATIONS) db.exec(migration.sql);
		const state = loadSnapshot(
			saved({
				skillRuntimeVersion: 1,
				skills,
				skillBlock: { code: "revoked" },
			}),
		);
		createRunStore(db).save(
			{
				id: runId,
				workspaceId: id(8),
				autonomyLevel: 2,
				budget: { cloudRequests: 10, maxHours: 1 },
				createdAt: "2026-11-09T00:00:00Z",
			},
			state,
		);
		db.close();
		const reopened = new Database(file);
		databases.push(reopened);
		const restored = createRunStore(reopened).load(runId)?.snapshot.context;
		expect(restored?.skillRuntimeVersion).toBe(1);
		expect(restored?.skills).toEqual(skills);
		expect(restored?.skillBlock).toEqual({ code: "revoked" });
		expect(restored?.messages).toEqual([]);
	});

	it("refuses rebound owners, duplicate contexts and impossible selection origins", () => {
		const context = skills.contexts[0];
		if (!context) throw new Error("fixture has no context");
		for (const changed of [
			{ ...skills, runId: id(9) },
			{ ...skills, contexts: [context, context] },
			{ ...skills, policy: { mode: "off", roles: [] } },
			{
				...skills,
				contexts: [
					{ ...context, snapshots: [{ ...snapshot, origin: "model" }] },
				],
			},
			{
				...skills,
				contexts: [{ ...context, owner: { ...owner, contextId: id(9) } }],
			},
			{ ...skills, policy: { mode: "manual", roles: [] } },
		]) {
			expect(RunSkillStateSchema.safeParse(changed).success).toBe(false);
			expect(() =>
				loadSnapshot(saved({ skillRuntimeVersion: 1, skills: changed })),
			).toThrow();
		}
	});

	it("retains earlier contexts and refuses duplicate receipt membership across them", () => {
		const other = { ...owner, contextId: id(9) };
		const next = {
			...skills,
			contexts: [
				...skills.contexts,
				{
					owner: other,
					roleId: "assistant",
					snapshots: [{ ...snapshot, receiptId: id(10), owner: other }],
				},
			],
		};
		expect(RunSkillStateSchema.parse(next)).toEqual(next);
		expect(
			RunSkillStateSchema.safeParse({
				...next,
				contexts: [
					...skills.contexts,
					{
						owner: other,
						roleId: "assistant",
						snapshots: [{ ...snapshot, owner: other }],
					},
				],
			}).success,
		).toBe(false);
	});
});
