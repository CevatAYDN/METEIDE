import { createHash } from "node:crypto";
import { ok } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	createSkillPreviews,
	maskedInspectionDigest,
} from "../../src/application/skill-previews.js";
import {
	SKILL_PREVIEW_LIMIT,
	SKILL_PREVIEW_TTL_MS,
} from "../../src/defaults.js";
import { skillFixture } from "../helpers/skill-readers.js";

const setup = () => {
	const f = skillFixture();
	const clock = { now: 0, revision: 0 };
	const grants = {
		list: () => ok([]),
		read: () =>
			ok(
				clock.revision
					? {
							source: f.inspection.source,
							sha256: f.inspection.sha256,
							enabled: true,
							revision: clock.revision,
						}
					: undefined,
			),
	};
	const options = { ...f.options, grants, now: () => clock.now };
	const previews = createSkillPreviews(options);
	const prepare = () =>
		previews.prepare(
			{ sourceId: f.inspection.source.sourceId },
			new AbortController().signal,
		);
	return { ...f, clock, options, previews, prepare };
};
describe("process-local skill previews", () => {
	it("retains identities and digests, not bodies, separately from mutable outbound data", async () => {
		const f = setup();
		const prepared = await f.prepare();
		expect(prepared.ok).toBe(true);
		if (!prepared.ok) return;
		const preview = prepared.value;
		const digest = maskedInspectionDigest(preview.inspection);
		expect(preview.inspection.sha256).toBe(f.inspection.sha256);
		expect(preview.expiresAt).toBe(
			new Date(SKILL_PREVIEW_TTL_MS).toISOString(),
		);
		preview.inspection.text = "caller replacement";
		preview.inspection.source.path = "caller/SKILL.md";
		const retained = f.previews.consume(preview.previewId);
		expect(retained).toMatchObject({
			ok: true,
			value: {
				source: f.inspection.source,
				sha256: f.inspection.sha256,
				maskedSha256: digest,
				revision: 0,
			},
		});
		expect(JSON.stringify(retained)).not.toContain("caller replacement");
		expect(JSON.stringify(retained)).not.toContain(
			JSON.stringify(f.inspection.text),
		);
		expect(f.previews.consume(preview.previewId).ok).toBe(false);
		expect(createSkillPreviews(f.options).consume(preview.previewId).ok).toBe(
			false,
		);
	});
	it("canonicalizes metadata ordering without treating masked text as the raw hash", () => {
		const { inspection } = skillFixture();
		const a = {
			...inspection,
			metadata: { ...inspection.metadata, metadata: { a: "1", z: "2" } },
		};
		const b = {
			...inspection,
			metadata: { ...inspection.metadata, metadata: { z: "2", a: "1" } },
		};
		expect(maskedInspectionDigest(a)).toBe(maskedInspectionDigest(b));
		expect(maskedInspectionDigest(a)).not.toBe(
			createHash("sha256").update(a.text).digest("hex"),
		);
	});
	it("reserves capacity across concurrent prepares and frees consumed slots", async () => {
		const f = setup();
		const results = await Promise.all(
			Array.from({ length: SKILL_PREVIEW_LIMIT + 1 }, () => f.prepare()),
		);
		expect(results.filter((r) => r.ok)).toHaveLength(SKILL_PREVIEW_LIMIT);
		expect(results.filter((r) => !r.ok)).toEqual([
			{ ok: false, error: { code: "limit_exceeded" } },
		]);
		const first = results[0];
		if (!first?.ok) throw new Error("first preview missing");
		f.previews.consume(first.value.previewId);
		expect((await f.prepare()).ok).toBe(true);
		f.clock.now = SKILL_PREVIEW_TTL_MS;
		expect((await f.prepare()).ok).toBe(true);
	});
	it("expires at the deadline and clears process-local previews", async () => {
		const f = setup();
		const result = await f.prepare();
		if (!result.ok) throw new Error("preview missing");
		f.clock.now = SKILL_PREVIEW_TTL_MS;
		expect(f.previews.consume(result.value.previewId)).toEqual({
			ok: false,
			error: { code: "expired" },
		});
		const next = await f.prepare();
		if (!next.ok) throw new Error("replacement preview missing");
		f.previews.clear();
		expect(f.previews.consume(next.value.previewId).ok).toBe(false);
	});
	it("refuses revision changes during masking and incomplete inventories", async () => {
		const f = setup();
		const mask = f.adapters.masker.impl.mask;
		f.adapters.masker.impl.mask = async (text) => {
			f.clock.revision = 1;
			return mask(text);
		};
		expect(await f.prepare()).toEqual({ ok: false, error: { code: "stale" } });
		f.sourceList.complete = false;
		expect((await f.prepare()).ok).toBe(false);
	});
	it("validates source inputs strictly and rejects forged preview ids", async () => {
		const f = setup();
		const input = {
			sourceId: f.inspection.source.sourceId,
			sha256: f.inspection.sha256,
		};
		expect(
			await f.previews.prepare(input, new AbortController().signal),
		).toEqual({
			ok: false,
			error: { code: "bad_input" },
		});
		expect(f.previews.consume("caller-declared-id").ok).toBe(false);
	});
	it("rechecks the revision immediately before retaining a reviewed preview", async () => {
		const f = setup();
		const read = f.options.grants.read;
		let reads = 0;
		f.options.grants.read = () => {
			if (++reads === 3) f.clock.revision = 1;
			return read();
		};
		expect(await f.prepare()).toEqual({ ok: false, error: { code: "stale" } });
	});
	it("does not repopulate retired state from an in-flight preparation", async () => {
		const f = setup();
		const preparing = f.prepare();
		f.previews.clear();
		expect((await preparing).ok).toBe(false);
		expect((await f.prepare()).ok).toBe(false);
	});
});
