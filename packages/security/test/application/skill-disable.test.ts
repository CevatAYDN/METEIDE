import { err, ok, type SkillError } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createSkillDisabler } from "../../src/application/skill-disable.js";
import { mutationFixture } from "../helpers/skill-mutations.js";

describe("skill receipt revocation", () => {
	it.each(["not_found", "bad_input"] as const)(
		"disables an existing receipt despite a %s source",
		async (code) => {
			const f = mutationFixture();
			expect(f.seed().ok).toBe(true);
			let reads = 0;
			f.adapters.source.impl.read = async () => {
				reads++;
				return err<SkillError>({ code });
			};
			f.adapters.catalog.impl.inspect = async () => {
				reads++;
				return err<SkillError>({ code });
			};
			f.sourceList.sources = [];
			f.catalogList.entries = [];
			const result = await createSkillDisabler(f.options)(
				{
					sourceId: f.inspection.source.sourceId,
					expectedRevision: 1,
				},
				new AbortController().signal,
			);
			expect(result).toMatchObject({
				admitted: true,
				result: {
					ok: true,
					value: {
						status: "disabled",
						revision: 2,
						source: { path: "masked/SKILL.md" },
					},
				},
			});
			expect(JSON.stringify(result)).not.toContain("approvedSha256");
			expect(reads).toBe(0);
			expect(f.options.grants.read(f.inspection.source.sourceId)).toMatchObject(
				{
					ok: true,
					value: { enabled: false, sha256: f.inspection.sha256, revision: 2 },
				},
			);
		},
	);

	it("does not create receipts or bypass their acknowledged revision", async () => {
		const f = mutationFixture();
		const disable = createSkillDisabler(f.options);
		const input = {
			sourceId: f.inspection.source.sourceId,
			expectedRevision: 0,
		};
		expect(await disable(input, new AbortController().signal)).toEqual({
			admitted: true,
			result: { ok: false, error: { code: "not_found" } },
		});
		expect(f.seed().ok).toBe(true);
		expect(await disable(input, new AbortController().signal)).toEqual({
			admitted: true,
			result: { ok: false, error: { code: "stale" } },
		});
		const forged = { ...input, sha256: "forged" };
		expect((await disable(forged, new AbortController().signal)).admitted).toBe(
			false,
		);
		expect(
			f.db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
		).toBe(1);
	});

	it.each(["abort", "audit", "adapter", "admission"] as const)(
		"preserves admission without revoking on %s failure",
		async (failure) => {
			const f = mutationFixture();
			f.seed();
			const controller = new AbortController();
			f.state.admit = async () => {
				if (failure === "admission")
					return { admitted: true, result: err({ code: "stale" }) };
				const inject = {
					abort: () => controller.abort(),
					adapter: () => {
						Object.assign(f.adapters.catalog, {
							impl: { ...f.adapters.catalog.impl },
						});
					},
					audit: () => {
						f.db.exec(`CREATE TRIGGER reject_disable BEFORE INSERT ON skill_trust_decisions
				BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
					},
				};
				inject[failure]();
				return { admitted: true, result: ok(undefined) };
			};
			expect(
				await createSkillDisabler(f.options)(
					{
						sourceId: f.inspection.source.sourceId,
						expectedRevision: 1,
					},
					controller.signal,
				),
			).toMatchObject({ admitted: true, result: { ok: false } });
			expect(f.options.grants.read(f.inspection.source.sourceId)).toMatchObject(
				{
					ok: true,
					value: { enabled: true, revision: 1 },
				},
			);
			expect(
				f.db
					.prepare("SELECT COUNT(*) FROM skill_trust_decisions")
					.pluck()
					.get(),
			).toBe(1);
		},
	);

	it("CAS permits only one of two concurrent revocations", async () => {
		const f = mutationFixture();
		f.seed();
		const disable = createSkillDisabler(f.options);
		const results = await Promise.all(
			[1, 2].map(() =>
				disable(
					{
						sourceId: f.inspection.source.sourceId,
						expectedRevision: 1,
					},
					new AbortController().signal,
				),
			),
		);
		expect(results.filter((r) => r.result.ok)).toHaveLength(1);
		expect(results.filter((r) => !r.result.ok)).toHaveLength(1);
		expect(results.every((r) => r.admitted)).toBe(true);
		expect(
			f.db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
		).toBe(2);
	});
});
