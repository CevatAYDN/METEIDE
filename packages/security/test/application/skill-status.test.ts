import { err, ok, type SkillError } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	readSkillStatus,
	type SkillGrant,
} from "../../src/application/skill-status.js";
import { skillFixture } from "../helpers/skill-readers.js";

const setup = () => {
	const f = skillFixture();
	const records: SkillGrant[] = [];
	const grants = {
		list: () => ok(records),
		read: (id: string) =>
			ok(records.find(({ source }) => source.sourceId === id)),
	};
	const record = {
		source: f.inspection.source,
		sha256: f.inspection.sha256,
		enabled: true,
		revision: 1,
	};
	const grant = () => records.push(record);
	const status = () =>
		readSkillStatus({ ...f.options, grants }, new AbortController().signal);
	return { ...f, records, record, grants, grant, status };
};
describe("skill status evidence", () => {
	it("distinguishes unapproved, approved, changed and disabled without exposing raw text", async () => {
		const f = setup();
		expect(await f.status()).toMatchObject({
			ok: true,
			value: { entries: [{ status: "unapproved" }] },
		});
		f.grant();
		expect(await f.status()).toMatchObject({
			ok: true,
			value: { entries: [{ status: "approved" }] },
		});
		f.records[0] = { ...f.record, sha256: "c".repeat(64) };
		expect(await f.status()).toMatchObject({
			ok: true,
			value: { entries: [{ status: "changed" }] },
		});
		f.records[0] = { ...f.record, enabled: false };
		const result = await f.status();
		expect(result).toMatchObject({
			ok: true,
			value: { entries: [{ status: "disabled" }] },
		});
		expect(JSON.stringify(result)).not.toContain("approvedSha256");
		expect(JSON.stringify(result)).not.toContain("secret");
	});
	it.each(["source", "catalog"] as const)(
		"refuses incomplete or malformed %s inventory",
		async (key) => {
			const f = setup();
			f.grant();
			const list = key === "source" ? f.sourceList : f.catalogList;
			list.complete = false;
			expect((await f.status()).ok).toBe(false);
			Object.assign(f.adapters[key].impl, {
				list: async () => ok({ complete: true }),
			});
			expect((await f.status()).ok).toBe(false);
		},
	);
	it("requires matching direct source and catalog evidence", async () => {
		const f = setup();
		f.grant();
		f.adapters.source.impl.read = async () =>
			ok({
				source: f.inspection.source,
				sha256: f.inspection.sha256,
				text: "different",
			});
		expect((await f.status()).ok).toBe(false);
	});
	it("rejects catalog entries outside the directly enumerated inventory", async () => {
		const f = setup();
		f.sourceList.sources = [];
		expect((await f.status()).ok).toBe(false);
		Object.assign(f.sourceList, {
			diagnostics: [
				{ code: "ignored", sourceId: f.inspection.source.sourceId },
			],
		});
		expect((await f.status()).ok).toBe(false);
	});
	it("does not erase diagnostics whose source has no safe descriptor", async () => {
		const f = setup();
		f.sourceList.sources = [];
		f.catalogList.entries = [];
		const diagnostic = { code: "unavailable", sourceId: "f".repeat(64) };
		Object.assign(f.sourceList, { diagnostics: [diagnostic] });
		expect(await f.status()).toEqual({
			ok: true,
			value: { entries: [], complete: true, diagnostics: [diagnostic] },
		});
	});
	it("rejects catalog diagnostic IDs absent from native descriptors and diagnostics", async () => {
		const f = setup();
		Object.assign(f.catalogList, {
			diagnostics: [{ code: "ignored", sourceId: "f".repeat(64) }],
		});
		expect((await f.status()).ok).toBe(false);
	});
	it.each(["source", "catalog"] as const)(
		"preserves harmless unidentified %s invalidity without inventing entries",
		async (owner) => {
			const f = setup();
			f.sourceList.sources = [];
			f.catalogList.entries = [];
			const diagnostic = { code: "bad_input", location: "path" };
			Object.assign(owner === "source" ? f.sourceList : f.catalogList, {
				diagnostics: [diagnostic],
			});
			expect(await f.status()).toEqual({
				ok: true,
				value: { entries: [], complete: true, diagnostics: [diagnostic] },
			});
		},
	);
	it.each(["source", "catalog"] as const)(
		"refuses root-unreadable %s inventory despite a complete claim",
		async (owner) => {
			const f = setup();
			f.grant();
			Object.assign(owner === "source" ? f.sourceList : f.catalogList, {
				diagnostics: [{ code: "unavailable", location: "root" }],
			});
			expect((await f.status()).ok).toBe(false);
		},
	);
	it.each(["bad_input", "unavailable"] as const)(
		"shows current %s files even without catalog entries",
		async (code) => {
			const f = setup();
			f.catalogList.entries = [];
			Object.assign(f.catalogList, {
				diagnostics: [{ code, sourceId: f.inspection.source.sourceId }],
			});
			const status = code === "bad_input" ? "invalid" : "unavailable";
			expect(await f.status()).toMatchObject({
				ok: true,
				value: { entries: [{ status, revision: 0 }] },
			});
		},
	);
	it.each(["not_found", "unavailable", "bad_input"] as const)(
		"retains only enabled grant identity on %s",
		async (code) => {
			const f = setup();
			f.grant();
			f.adapters.catalog.impl.inspect = async () => err<SkillError>({ code });
			const result = await f.status();
			expect(result).toMatchObject({
				ok: true,
				value: { entries: [{ approvedSha256: f.inspection.sha256 }] },
			});
			expect(JSON.stringify(result)).not.toContain("currentSha256");
			f.records[0] = { ...f.record, enabled: false };
			expect(JSON.stringify(await f.status())).not.toContain("approvedSha256");
		},
	);
	it("retains a missing historical source and refuses storage failure", async () => {
		const f = setup();
		f.grant();
		f.sourceList.sources = [];
		f.catalogList.entries = [];
		expect(await f.status()).toMatchObject({
			ok: true,
			value: { entries: [{ status: "missing" }] },
		});
		Object.assign(f.grants, { list: () => err({ code: "storage_failed" }) });
		expect(await f.status()).toEqual({
			ok: false,
			error: { code: "storage_failed" },
		});
	});
	it("refuses a grant set changed while outbound text is being masked", async () => {
		const f = setup();
		f.grant();
		const mask = f.adapters.masker.impl.mask;
		f.adapters.masker.impl.mask = async (text) => {
			f.records[0] = { ...f.record, enabled: false, revision: 2 };
			return mask(text);
		};
		expect(await f.status()).toEqual({ ok: false, error: { code: "stale" } });
	});
});
