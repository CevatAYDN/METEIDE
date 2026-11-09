import { err, ok, type SkillTrustEntry } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { readSkillRuntimeCatalog } from "../../src/application/skill-runtime-catalog.js";
import { skillRuntimeFixture } from "../helpers/skill-runtime.js";

const signal = () => new AbortController().signal;
const unavailable = (code = "unavailable") =>
	ok({ status: "unavailable", entries: [], diagnostics: [{ code }] });
const empty = ok({ status: "ready", entries: [], diagnostics: [] });
const approved = (n: number): SkillTrustEntry => ({
	source: {
		sourceId: n.toString(16).padStart(64, "0"),
		scope: "workspace",
		path: `masked-${n}/SKILL.md`,
	},
	status: "approved",
	revision: n,
	approvedSha256: "b".repeat(64),
	currentSha256: "b".repeat(64),
	metadata: { name: "review", description: "Already masked description" },
	diagnostics: [],
});

describe("native runtime skill catalog", () => {
	it("offers only approved exact versions, preserving names and full masked descriptions", async () => {
		const f = skillRuntimeFixture();
		const first = approved(1);
		const second = approved(2);
		const description = ` \ufeff\u00e9\r\n${"x".repeat(1000)} `;
		first.metadata = { name: "review", description };
		f.status.entries = [
			first,
			second,
			{ ...approved(3), status: "disabled" },
			{ ...approved(4), status: "changed", currentSha256: "c".repeat(64) },
			{ ...approved(5), status: "unapproved" },
		];
		f.adapters.source.impl.read = f.management;
		f.adapters.source.impl.list = f.management;
		f.adapters.catalog.impl.inspect = f.management;
		f.adapters.catalog.impl.list = f.management;
		expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
			ok({
				status: "ready",
				entries: [
					{
						version: {
							sourceId: first.source.sourceId,
							sha256: "b".repeat(64),
							revision: 1,
						},
						source: first.source,
						name: "review",
						description,
					},
					{
						version: {
							sourceId: second.source.sourceId,
							sha256: "b".repeat(64),
							revision: 2,
						},
						source: second.source,
						name: "review",
						description: "Already masked description",
					},
				],
				diagnostics: [],
			}),
		);
		expect(f.trust.status).toHaveBeenCalledOnce();
		expect(f.management).not.toHaveBeenCalled();
		expect(f.seen).toEqual([]);
	});

	it("distinguishes complete ready-empty from unavailable status", async () => {
		const f = skillRuntimeFixture();
		expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(empty);
		f.status.complete = false;
		expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
			unavailable(),
		);
		f.status.diagnostics = [{ code: "limit_exceeded" }];
		expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
			unavailable("limit_exceeded"),
		);
	});

	it.each([128, 129])(
		"never emits a prefix from %i eligible descriptors",
		async (count) => {
			const f = skillRuntimeFixture();
			f.status.entries = Array.from({ length: count }, (_, n) =>
				approved(n + 1),
			);
			expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
				unavailable("budget_exceeded"),
			);
			expect(f.status.entries).toHaveLength(count);
			for (const entry of f.status.entries) entry.status = "disabled";
			expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(empty);
		},
	);

	it("refuses a complete catalog above 16 KiB without truncating descriptions", async () => {
		const f = skillRuntimeFixture();
		f.status.entries = Array.from({ length: 16 }, (_, n) => ({
			...approved(n + 1),
			metadata: { name: "review", description: "x".repeat(1024) },
		}));
		expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
			unavailable("budget_exceeded"),
		);
		expect(f.status.entries).toHaveLength(16);
		expect(
			f.status.entries.every(
				(entry) => entry.metadata?.description.length === 1024,
			),
		).toBe(true);
	});

	it.each(["metadata", "approvedSha256", "currentSha256"] as const)(
		"refuses a missing approved %s field instead of skipping its entry",
		async (field) => {
			const f = skillRuntimeFixture();
			const invalid = approved(2);
			delete invalid[field];
			f.status.entries = [approved(1), invalid];
			expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
				unavailable(),
			);
		},
	);

	it.each(["missing", "trust", "masker"] as const)(
		"refuses %s native evidence",
		async (kind) => {
			const f = skillRuntimeFixture();
			if (kind === "missing") f.registration.dispose();
			if (kind === "trust") f.options.nativeTrust.delete(f.trust);
			if (kind === "masker")
				f.options.nativeMaskers.delete(f.adapters.masker.impl);
			expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
				unavailable(),
			);
			expect(f.trust.status).not.toHaveBeenCalled();
		},
	);

	it.each(["aborted", "stale"] as const)(
		"keeps a late %s result as an error",
		async (code) => {
			const f = skillRuntimeFixture();
			const controller = new AbortController();
			const pending =
				Promise.withResolvers<Awaited<ReturnType<typeof f.trust.status>>>();
			f.trust.status.mockReturnValue(pending.promise);
			const result = readSkillRuntimeCatalog(f.options, controller.signal);
			if (code === "aborted") controller.abort();
			else f.lifecycle.current = false;
			pending.resolve(ok(f.status));
			expect(await result).toEqual(err({ code }));
		},
	);

	it("refuses already cancelled or retired calls without reading status", async () => {
		const f = skillRuntimeFixture();
		const controller = new AbortController();
		controller.abort();
		expect(await readSkillRuntimeCatalog(f.options, controller.signal)).toEqual(
			err({ code: "aborted" }),
		);
		f.lifecycle.current = false;
		expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
			err({ code: "stale" }),
		);
		expect(f.trust.status).not.toHaveBeenCalled();
	});

	it.each([
		{},
		ok({ entries: [{}], complete: true, diagnostics: [] }),
		err({ code: "unavailable", message: "private root and body" }),
	])("rejects malformed or leaking status %#", async (raw) => {
		const f = skillRuntimeFixture();
		Object.assign(f.trust, { status: async () => raw });
		expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
			unavailable(),
		);
	});

	it.each(["stale", "aborted", "storage_failed"] as const)(
		"preserves safe status failure %s",
		async (code) => {
			const f = skillRuntimeFixture();
			f.trust.status.mockResolvedValue(err({ code }));
			const expected =
				code === "storage_failed" ? unavailable(code) : err({ code });
			expect(await readSkillRuntimeCatalog(f.options, signal())).toEqual(
				expected,
			);
		},
	);
});
