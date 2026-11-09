import { ok } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import type { SkillAdmission } from "../../src/application/skill-mutation.js";
import { createSkillTrustAdapter } from "../../src/application/skill-trust.js";
import { mutationFixture } from "../helpers/skill-mutations.js";

describe("one native trust adapter lifetime", () => {
	it("provides all four operations without admitting read-only work", async () => {
		const f = mutationFixture();
		let admissions = 0;
		f.state.admit = async () => {
			admissions++;
			return { admitted: true, result: ok(undefined) };
		};
		const trust = createSkillTrustAdapter(f.options);
		const signal = new AbortController().signal;
		const sourceId = f.inspection.source.sourceId;
		expect((await trust.impl.status(signal)).ok).toBe(true);
		const preview = await trust.impl.prepare({ sourceId }, signal);
		if (!preview.ok) throw new Error("preview missing");
		expect(admissions).toBe(0);
		expect(
			(await trust.impl.approve({ previewId: preview.value.previewId }, signal))
				.result.ok,
		).toBe(true);
		expect(
			(await trust.impl.disable({ sourceId, expectedRevision: 1 }, signal))
				.result.ok,
		).toBe(true);
		expect(admissions).toBe(2);
		await trust.close();
		expect((await trust.impl.status(signal)).ok).toBe(false);
	});

	it("keeps an ignored approved source revocable without restoring eligibility", async () => {
		const f = mutationFixture();
		const trust = createSkillTrustAdapter(f.options);
		const signal = new AbortController().signal;
		const sourceId = f.inspection.source.sourceId;
		const prepared = await trust.impl.prepare({ sourceId }, signal);
		if (!prepared.ok) throw new Error("preview missing");
		expect(
			(
				await trust.impl.approve(
					{ previewId: prepared.value.previewId },
					signal,
				)
			).result.ok,
		).toBe(true);
		const beforeIgnore = await trust.impl.prepare({ sourceId }, signal);
		if (!beforeIgnore.ok) throw new Error("second preview missing");
		const diagnostic = { code: "ignored", sourceId };
		f.sourceList.sources = [];
		f.catalogList.entries = [];
		Object.assign(f.sourceList, { diagnostics: [diagnostic] });
		Object.assign(f.catalogList, { diagnostics: [diagnostic] });
		const status = await trust.impl.status(signal);
		expect(status).toMatchObject({
			ok: true,
			value: {
				complete: true,
				entries: [
					{
						status: "invalid",
						revision: 1,
						approvedSha256: f.inspection.sha256,
						diagnostics: expect.arrayContaining([diagnostic]),
					},
				],
			},
		});
		expect(JSON.stringify(status)).not.toContain("currentSha256");
		expect((await trust.impl.prepare({ sourceId }, signal)).ok).toBe(false);
		expect(
			(
				await trust.impl.approve(
					{ previewId: beforeIgnore.value.previewId },
					signal,
				)
			).result.ok,
		).toBe(false);
		if (!status.ok || !status.value.entries[0])
			throw new Error("receipt unavailable");
		expect(
			await trust.impl.disable(
				{
					sourceId,
					expectedRevision: status.value.entries[0].revision,
				},
				signal,
			),
		).toMatchObject({
			admitted: true,
			result: {
				ok: true,
				value: {
					status: "disabled",
					revision: 2,
				},
			},
		});
		expect(f.options.grants.read(sourceId)).toMatchObject({
			ok: true,
			value: { enabled: false, revision: 2, sha256: f.inspection.sha256 },
		});
		const after = await trust.impl.status(signal);
		expect(after).toMatchObject({
			ok: true,
			value: { entries: [{ status: "invalid", revision: 2 }] },
		});
		expect(JSON.stringify(after)).not.toContain("approvedSha256");
		expect(
			f.db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
		).toBe(2);
		await trust.close();
	});

	it("drains in-flight admission and keeps its admitted failure during retirement", async () => {
		const f = mutationFixture();
		const trust = createSkillTrustAdapter(f.options);
		const signal = new AbortController().signal;
		const prepared = await trust.impl.prepare(
			{ sourceId: f.inspection.source.sourceId },
			signal,
		);
		if (!prepared.ok) throw new Error("preview missing");
		let finish: ((result: SkillAdmission) => void) | undefined;
		let entered = false;
		f.state.admit = () => {
			entered = true;
			return new Promise((resolve) => {
				finish = resolve;
			});
		};
		const approving = trust.impl.approve(
			{ previewId: prepared.value.previewId },
			signal,
		);
		expect(entered).toBe(true);
		let closed = false;
		const closing = trust.close().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		if (!finish) throw new Error("guard did not start");
		finish({ admitted: true, result: ok(undefined) });
		expect(await approving).toEqual({
			admitted: true,
			result: { ok: false, error: { code: "unavailable" } },
		});
		await closing;
		expect(f.options.grants.list()).toEqual({ ok: true, value: [] });
		expect(
			(
				await trust.impl.disable(
					{
						sourceId: f.inspection.source.sourceId,
						expectedRevision: 0,
					},
					signal,
				)
			).admitted,
		).toBe(false);
	});
});
