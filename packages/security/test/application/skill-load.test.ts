import { createHash } from "node:crypto";
import {
	err,
	ok,
	type SkillRuntimeLoadInput,
	type SkillTrustEntry,
	skillSnapshotCanonical,
} from "@mete/contracts";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	loadSkillVersion,
	type SkillLoadOptions,
} from "../../src/application/skill-load.js";
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
const loadInput = (): SkillRuntimeLoadInput => ({
	owner: { runId: id(1), contextId: id(2) },
	operationId: id(3),
	version: { sourceId: "a".repeat(64), sha256: "b".repeat(64), revision: 1 },
	origin: "explicit",
});
const databases: Database.Database[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

const setup = () => {
	const f = skillRuntimeFixture();
	f.status.entries = [grant()];
	const db = new Database(":memory:");
	databases.push(db);
	for (const migration of SKILL_RUNTIME_MIGRATIONS) db.exec(migration.sql);
	const store = createSkillRuntimeStore(db);
	const input = loadInput();
	const live = new WeakSet<SkillRuntimeLoadInput>([input]);
	const admission = {
		live: vi.fn((value: SkillRuntimeLoadInput) => live.has(value)),
		fits: vi.fn((_value: SkillRuntimeLoadInput, _bytes: number) => true),
	};
	const opts: SkillLoadOptions = {
		...f.options,
		admission,
		store,
		workspaceKey,
		now: () => new Date("2026-11-09T00:00:00.000Z"),
		newId: () => id(9),
	};
	const receipts = () => store.inventory(workspaceKey, id(1));
	return { f, opts, input, live, admission, receipts };
};

describe("skill.runtime@1 load", () => {
	it("returns a masked snapshot only after its receipt is durable", async () => {
		const s = setup();
		const result = await loadSkillVersion(s.opts, s.input, signal());
		if (!result.ok) throw new Error(result.error.code);
		const snapshot = result.value;
		expect(snapshot.inspection.text).not.toContain("secret");
		expect(snapshot.inspection.sha256).toBe("b".repeat(64));
		const { payloadSha256, ...unsigned } = snapshot;
		expect(payloadSha256).toBe(
			createHash("sha256")
				.update(skillSnapshotCanonical(unsigned))
				.digest("hex"),
		);
		expect(s.receipts()).toEqual(
			ok({
				runId: id(1),
				receipts: [
					{
						...s.input,
						receiptId: id(9),
						loadedAt: "2026-11-09T00:00:00.000Z",
						payloadSha256,
					},
				],
			}),
		);
		expect(s.admission.fits).toHaveBeenCalledWith(
			s.input,
			new TextEncoder().encode(snapshot.inspection.text).byteLength,
		);
	});

	it("refuses an equal but not admitted input object", async () => {
		const s = setup();
		expect(await loadSkillVersion(s.opts, loadInput(), signal())).toEqual(
			err({ code: "stale" }),
		);
		expect(s.f.trust.status).not.toHaveBeenCalled();
		expect(s.receipts()).toEqual(ok({ runId: id(1), receipts: [] }));
	});

	it("issues no receipt when the retained context budget refuses", async () => {
		const s = setup();
		s.admission.fits.mockReturnValue(false);
		expect(await loadSkillVersion(s.opts, s.input, signal())).toEqual(
			err({ code: "budget_exceeded", sourceId: "a".repeat(64) }),
		);
		expect(s.receipts()).toEqual(ok({ runId: id(1), receipts: [] }));
	});

	it("issues no receipt when admission ends during preparation", async () => {
		const s = setup();
		s.f.adapters.catalog.impl.inspect = async () => {
			s.live.delete(s.input);
			return ok(s.f.inspection);
		};
		expect(await loadSkillVersion(s.opts, s.input, signal())).toEqual(
			err({ code: "stale" }),
		);
		expect(s.receipts()).toEqual(ok({ runId: id(1), receipts: [] }));
	});

	it("issues no receipt when the grant is disabled during masking", async () => {
		const s = setup();
		s.f.trust.status
			.mockResolvedValueOnce(ok(s.f.status))
			.mockResolvedValueOnce(
				ok({ ...s.f.status, entries: [grant({ status: "disabled" })] }),
			);
		expect(await loadSkillVersion(s.opts, s.input, signal())).toEqual(
			err({ code: "revoked", sourceId: "a".repeat(64) }),
		);
		expect(s.receipts()).toEqual(ok({ runId: id(1), receipts: [] }));
	});

	it("refuses changed source bytes as an integrity failure", async () => {
		const s = setup();
		s.f.inspection.sha256 = "d".repeat(64);
		expect(await loadSkillVersion(s.opts, s.input, signal())).toEqual(
			err({ code: "integrity_failed", sourceId: "a".repeat(64) }),
		);
	});

	it("refuses a repeated source in the same context instead of a second receipt", async () => {
		const s = setup();
		expect((await loadSkillVersion(s.opts, s.input, signal())).ok).toBe(true);
		const again = { ...loadInput(), operationId: id(4) };
		s.live.add(again);
		const opts = { ...s.opts, newId: () => id(10) };
		expect(await loadSkillVersion(opts, again, signal())).toEqual(
			err({ code: "stale" }),
		);
	});

	it("maps a throwing store to storage_failed", async () => {
		const s = setup();
		const opts = {
			...s.opts,
			store: {
				issue: () => {
					throw new Error("disk");
				},
			},
		};
		expect(await loadSkillVersion(opts, s.input, signal())).toEqual(
			err({ code: "storage_failed" }),
		);
	});

	it("keeps a late abort as an error without a receipt", async () => {
		const s = setup();
		const controller = new AbortController();
		s.f.adapters.catalog.impl.inspect = async () => {
			controller.abort();
			return ok(s.f.inspection);
		};
		expect(await loadSkillVersion(s.opts, s.input, controller.signal)).toEqual(
			err({ code: "aborted" }),
		);
		expect(s.receipts()).toEqual(ok({ runId: id(1), receipts: [] }));
	});
});
