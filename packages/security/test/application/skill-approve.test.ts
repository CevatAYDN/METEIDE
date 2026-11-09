import { err, ok, type SkillError } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createSkillApprover } from "../../src/application/skill-approve.js";
import { SKILL_PREVIEW_TTL_MS } from "../../src/defaults.js";
import { mutationFixture } from "../helpers/skill-mutations.js";

describe("version-bound skill approval", () => {
	it("acknowledges only a committed exact grant with masked display data", async () => {
		const f = mutationFixture();
		const preview = await f.prepare();
		const result = await createSkillApprover(f.options, f.previews)(
			{ previewId: preview.previewId },
			new AbortController().signal,
		);
		expect(result).toMatchObject({
			admitted: true,
			result: {
				ok: true,
				value: {
					status: "approved",
					revision: 1,
					approvedSha256: f.inspection.sha256,
					source: { path: "masked/SKILL.md" },
				},
			},
		});
		expect(f.options.grants.read(f.inspection.source.sourceId)).toMatchObject({
			ok: true,
			value: { enabled: true, revision: 1 },
		});
		const audit = f.db
			.prepare("SELECT record FROM skill_trust_decisions")
			.pluck()
			.all();
		expect(audit).toHaveLength(1);
		expect(JSON.stringify(audit)).not.toContain("metadata");
		expect(JSON.stringify(audit)).not.toContain("body");
	});

	it.each([
		"bytes",
		"masking",
		"adapter",
		"expiry",
		"audit",
		"abort",
		"admission",
	] as const)(
		"retains admission and writes nothing after post-drain %s failure",
		async (failure) => {
			const f = mutationFixture();
			const preview = await f.prepare();
			const controller = new AbortController();
			f.state.admit = async () => {
				if (failure === "admission")
					return { admitted: true, result: err({ code: "stale" }) };
				const inject = {
					bytes: () => {
						f.inspection.sha256 = "c".repeat(64);
					},
					masking: () => {
						f.adapters.masker.impl.mask = async (text) => ({ text, masked: 0 });
					},
					adapter: () => {
						Object.assign(f.adapters.masker, {
							impl: { ...f.adapters.masker.impl },
						});
					},
					expiry: () => {
						f.state.now = SKILL_PREVIEW_TTL_MS;
					},
					audit: () => {
						f.db.exec(`CREATE TRIGGER reject_decision BEFORE INSERT ON skill_trust_decisions
					BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
					},
					abort: () => controller.abort(),
				};
				inject[failure]();
				return { admitted: true, result: ok(undefined) };
			};
			const result = await createSkillApprover(f.options, f.previews)(
				{ previewId: preview.previewId },
				controller.signal,
			);
			expect(result).toMatchObject({ admitted: true, result: { ok: false } });
			if (failure === "abort")
				expect(result.result).toEqual({
					ok: false,
					error: { code: "aborted" },
				});
			expect(f.options.grants.list()).toEqual({ ok: true, value: [] });
			expect(
				f.db
					.prepare("SELECT COUNT(*) FROM skill_trust_decisions")
					.pluck()
					.get(),
			).toBe(0);
		},
	);

	it("consumes a preview even when admission is refused", async () => {
		const f = mutationFixture();
		const preview = await f.prepare();
		let calls = 0;
		f.state.admit = async () => {
			calls++;
			return { admitted: false, result: err<SkillError>({ code: "busy" }) };
		};
		const approve = createSkillApprover(f.options, f.previews);
		const input = { previewId: preview.previewId };
		expect(await approve(input, new AbortController().signal)).toEqual({
			admitted: false,
			result: { ok: false, error: { code: "busy" } },
		});
		expect((await approve(input, new AbortController().signal)).result.ok).toBe(
			false,
		);
		expect(calls).toBe(1);
	});

	it("leaves a newer revision intact when the reviewed revision is stale", async () => {
		const f = mutationFixture();
		const preview = await f.prepare();
		expect(f.seed().ok).toBe(true);
		expect(
			await createSkillApprover(f.options, f.previews)(
				{ previewId: preview.previewId },
				new AbortController().signal,
			),
		).toEqual({
			admitted: true,
			result: { ok: false, error: { code: "stale" } },
		});
		expect(
			f.db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
		).toBe(1);
	});
});
