import {
	err,
	ok,
	type SkillRuntimeLoadInput,
	type SkillSnapshot,
	type SkillTrustEntry,
} from "@mete/contracts";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { checkSkillSnapshots } from "../../src/application/skill-check.js";
import { loadSkillVersion } from "../../src/application/skill-load.js";
import {
	createSkillRuntimeStore,
	SKILL_RUNTIME_MIGRATIONS,
} from "../../src/infrastructure/skill-runtime-store.js";
import { skillRuntimeFixture } from "../helpers/skill-runtime.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workspaceKey = "f".repeat(64);
const signal = () => new AbortController().signal;
const grant = (over: Partial<SkillTrustEntry> = {}): SkillTrustEntry => ({
	source: { sourceId: "a".repeat(64), scope: "workspace", path: "x/SKILL.md" },
	status: "approved",
	revision: 1,
	approvedSha256: "b".repeat(64),
	currentSha256: "b".repeat(64),
	metadata: { name: "secret", description: "secret" },
	diagnostics: [],
	...over,
});
const databases: Database.Database[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

/** Loads one real snapshot through A3, then exposes the check options. */
const loaded = async () => {
	const f = skillRuntimeFixture();
	f.status.entries = [grant()];
	const db = new Database(":memory:");
	databases.push(db);
	for (const migration of SKILL_RUNTIME_MIGRATIONS) db.exec(migration.sql);
	const store = createSkillRuntimeStore(db);
	const input: SkillRuntimeLoadInput = {
		owner: { runId: id(1), contextId: id(2) },
		operationId: id(3),
		version: { sourceId: "a".repeat(64), sha256: "b".repeat(64), revision: 1 },
		origin: "explicit",
	};
	const result = await loadSkillVersion(
		{
			...f.options,
			store,
			workspaceKey,
			admission: { live: (v) => v === input, fits: () => true },
			newId: () => id(9),
		},
		input,
		signal(),
	);
	if (!result.ok) throw new Error(result.error.code);
	const opts = { ...f.options, store, workspaceKey };
	const check = (snapshots: SkillSnapshot[], runId = id(1)) =>
		checkSkillSnapshots(opts, { runId, snapshots }, signal());
	return { f, opts, store, snapshot: result.value, check };
};

describe("skill.runtime@1 check", () => {
	it("accepts the exact retained snapshot of a current grant", async () => {
		const s = await loaded();
		expect(await s.check([s.snapshot])).toEqual(ok(undefined));
	});

	it("accepts a run with no receipts without optional discovery", async () => {
		const s = await loaded();
		s.f.trust.status.mockClear();
		expect(await s.check([], id(5))).toEqual(ok(undefined));
		expect(s.f.trust.status).not.toHaveBeenCalled();
	});

	it("refuses an omitted receipt instead of treating it as empty", async () => {
		const s = await loaded();
		expect(await s.check([])).toEqual(err({ code: "integrity_failed" }));
	});

	it.each([
		[
			"changed text",
			(x: SkillSnapshot) => {
				x.inspection.text += "\nextra";
			},
		],
		[
			"changed text with self-hash",
			(x: SkillSnapshot) => {
				x.inspection.text += "\nextra";
				x.payloadSha256 = "e".repeat(64);
			},
		],
		[
			"rebound owner",
			(x: SkillSnapshot) => {
				x.owner = { ...x.owner, contextId: id(7) };
			},
		],
		[
			"changed origin",
			(x: SkillSnapshot) => {
				x.origin = "model";
			},
		],
	])("refuses %s as an integrity failure", async (_name, mutate) => {
		const s = await loaded();
		const tampered = structuredClone(s.snapshot);
		mutate(tampered);
		expect(await s.check([tampered])).toEqual(
			err({ code: "integrity_failed" }),
		);
	});

	it.each([
		["disabled", grant({ status: "disabled" })],
		["reapproved revision", grant({ revision: 2 })],
	])("refuses a %s grant as revoked", async (_name, entry) => {
		const s = await loaded();
		s.f.status.entries = [entry];
		expect(await s.check([s.snapshot])).toEqual(
			err({ code: "revoked", sourceId: "a".repeat(64) }),
		);
	});

	it("refuses a receipt read from another workspace key", async () => {
		const s = await loaded();
		const opts = { ...s.opts, workspaceKey: "c".repeat(64) };
		expect(
			await checkSkillSnapshots(
				opts,
				{ runId: id(1), snapshots: [s.snapshot] },
				signal(),
			),
		).toEqual(err({ code: "integrity_failed" }));
	});

	it("maps a throwing inventory store to storage_failed", async () => {
		const s = await loaded();
		const opts = {
			...s.opts,
			store: {
				inventory: () => {
					throw new Error("disk");
				},
			},
		};
		expect(
			await checkSkillSnapshots(
				opts,
				{ runId: id(1), snapshots: [s.snapshot] },
				signal(),
			),
		).toEqual(err({ code: "storage_failed" }));
	});

	it("keeps a late stale lifetime as an error", async () => {
		const s = await loaded();
		s.f.trust.status.mockImplementation(async () => {
			s.f.lifecycle.current = false;
			return ok(s.f.status);
		});
		expect(await s.check([s.snapshot])).toEqual(err({ code: "stale" }));
	});
});
