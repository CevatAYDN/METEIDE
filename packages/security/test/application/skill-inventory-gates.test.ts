import { ok, SKILL_LIMITS } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createSkillTrustAdapter } from "../../src/application/skill-trust.js";
import { mutationFixture } from "../helpers/skill-mutations.js";

const exceedCatalogCapacity = (f: ReturnType<typeof mutationFixture>) => {
	const extra = Array.from(
		{ length: SKILL_LIMITS.catalogEntries },
		(_, index) => {
			const name = `skill-${index}`;
			return {
				source: {
					...f.inspection.source,
					sourceId: index.toString(16).padStart(64, "0"),
					path: `${name}/SKILL.md`,
				},
				metadata: { ...f.inspection.metadata, name },
			};
		},
	);
	f.catalogList.entries = [
		{ source: f.inspection.source, metadata: f.inspection.metadata },
		...extra,
	];
	f.sourceList.sources = f.catalogList.entries.map(({ source }) => source);
};
const expectNoWrites = (f: ReturnType<typeof mutationFixture>) => {
	expect(f.options.grants.list()).toEqual({ ok: true, value: [] });
	expect(
		f.db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
	).toBe(0);
};

describe("full skill inventories remain authorization gates", () => {
	it.each(["incomplete", "over-capacity"] as const)(
		"refuses preparation from an initially %s catalog",
		async (state) => {
			const f = mutationFixture();
			if (state === "incomplete") f.catalogList.complete = false;
			else exceedCatalogCapacity(f);
			const trust = createSkillTrustAdapter(f.options);
			expect(
				(
					await trust.impl.prepare(
						{
							sourceId: f.inspection.source.sourceId,
						},
						new AbortController().signal,
					)
				).ok,
			).toBe(false);
			expectNoWrites(f);
			await trust.close();
		},
	);

	it("rechecks the full inventory after admission when a preview's catalog grows to 129 entries", async () => {
		const f = mutationFixture();
		const trust = createSkillTrustAdapter(f.options);
		const signal = new AbortController().signal;
		const preview = await trust.impl.prepare(
			{ sourceId: f.inspection.source.sourceId },
			signal,
		);
		if (!preview.ok) throw new Error("preview missing");
		f.state.admit = async () => {
			exceedCatalogCapacity(f);
			return { admitted: true, result: ok(undefined) };
		};
		expect(
			await trust.impl.approve({ previewId: preview.value.previewId }, signal),
		).toMatchObject({
			admitted: true,
			result: { ok: false },
		});
		expectNoWrites(f);
		await trust.close();
	});
});
