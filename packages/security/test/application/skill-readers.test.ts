import { ok, SkillInspectionSchema } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	callSkill,
	captureSkillReaders,
	maskSkillInspection,
} from "../../src/application/skill-readers.js";
import { skillFixture } from "../helpers/skill-readers.js";

const signal = () => new AbortController().signal;
const captured = (f: ReturnType<typeof skillFixture>) => {
	const result = captureSkillReaders(f.options);
	if (!result.ok) throw new Error("fixture capture failed");
	return result.value;
};
describe("attested skill readers", () => {
	it("requires native implementation attestations, not adapter labels", () => {
		const f = skillFixture();
		f.options.nativeSources.delete(f.adapters.source.impl);
		expect(captureSkillReaders(f.options).ok).toBe(false);
		f.options.nativeSources.add(f.adapters.source.impl);
		f.options.nativeCatalogs.delete(f.adapters.catalog.impl);
		expect(captureSkillReaders(f.options).ok).toBe(false);
	});
	it.each(["source", "catalog", "masker"] as const)(
		"detects a changed %s impl after awaiting",
		async (key) => {
			const f = skillFixture();
			const readers = captured(f);
			const result = await callSkill(
				readers,
				signal(),
				SkillInspectionSchema,
				async () => {
					Object.assign(f.adapters[key], { impl: { ...f.adapters[key].impl } });
					return ok(f.inspection);
				},
			);
			expect(result).toEqual({ ok: false, error: { code: "stale" } });
		},
	);
	it("detects registry object replacement with the same implementation", () => {
		const f = skillFixture();
		const readers = captured(f);
		f.sourceRegistration.dispose();
		f.options.registry.provide("skill.source@1", { ...f.adapters.source });
		expect(readers.current()).toBe(false);
	});
	it("rejects malformed external failures without forwarding their text", async () => {
		const f = skillFixture();
		const result = await callSkill(
			captured(f),
			signal(),
			SkillInspectionSchema,
			async () => ({
				ok: false,
				error: { code: "unavailable", message: "secret" },
			}),
		);
		expect(result).toEqual({ ok: false, error: { code: "unavailable" } });
	});
	it("masks actual text, source path, metadata strings and pair keys independently", async () => {
		const f = skillFixture();
		const result = await maskSkillInspection(
			captured(f),
			f.inspection,
			signal(),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(JSON.stringify(result.value)).not.toContain("secret");
		expect(result.value.sha256).toBe(f.inspection.sha256);
		expect(f.seen).toContain('---\nname: "masked"\n---\nsecret body');
		expect(f.seen).toContain(f.inspection.source.path);
		expect(f.seen.filter((text) => text === "secret")).toHaveLength(7);
	});
	it("fails closed on mask failures, invalid rebuilt data and cancellation", async () => {
		const f = skillFixture();
		f.adapters.masker.impl.mask = async () => {
			throw new Error("secret");
		};
		expect(
			(await maskSkillInspection(captured(f), f.inspection, signal())).ok,
		).toBe(false);
		f.adapters.masker.impl.mask = async () => ({ text: "", masked: 1 });
		expect(
			(await maskSkillInspection(captured(f), f.inspection, signal())).ok,
		).toBe(false);
		const controller = new AbortController();
		controller.abort();
		expect(
			await callSkill(
				captured(f),
				controller.signal,
				SkillInspectionSchema,
				async () => ok(f.inspection),
			),
		).toEqual({ ok: false, error: { code: "aborted" } });
	});
});
