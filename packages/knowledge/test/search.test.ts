import { ok } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createKnowledgeSearchModule } from "../src/search-module.js";
import { paths, setup } from "./search-setup.js";

// knowledge.search@1's keyword source over real storage (docs/11, Hybrid search; ADR-149).

describe("knowledge.search@1", () => {
	it("finds a section by a word without its accents, with its note's facts and its rank", async () => {
		const s = await setup();
		expect(s.activated.ok).toBe(true);
		await s.note(
			"lessons/kahve.md",
			"---\ntype: lesson\ntitle: Kahve fiyatları\n---\n\nIntro.\n\n## Fiyat\nŞubat fiyatı 85 TL oldu.\n",
		);
		const r = await s.search({ query: "subat" });
		expect(r).toEqual(
			ok({
				results: [
					{
						path: "lessons/kahve.md",
						scope: "workspace",
						type: "lesson",
						title: "Kahve fiyatları",
						heading: "Fiyat",
						snippet: "Şubat fiyatı 85 TL oldu.",
						sources: { keyword: 1 },
					},
				],
			}),
		);
		expect(paths(await s.search({ query: "lesson" }))).toEqual([]);
		await s.close();
	});

	it("snips the section's text even when the word is in the title", async () => {
		const s = await setup();
		await s.note(
			"lessons/build.md",
			"---\ntype: lesson\ntitle: Check the build\n---\n\n# Check the build\n\nThe page passed review but the build failed.\n",
		);
		const r = await s.search({ query: "check" });
		expect(r.ok && r.value.results.map((h) => h.snippet)).toEqual([
			"The page passed review but the build failed.",
		]);
		await s.close();
	});

	it("never finds a private note, the history, a note of no type or an ignored file", async () => {
		const s = await setup();
		await s.note("lessons/a.md", "---\nprivate: true\n---\nsecret word");
		await s.note(
			".history/lessons/b.md/1.md",
			"---\ntype: lesson\n---\nsecret word",
		);
		await s.note("readme.md", "secret word");
		await s.note("decisions/c.md", "secret word");
		s.hidden.add(".mete/knowledge/decisions/c.md");
		expect(paths(await s.search({ query: "secret" }))).toEqual([]);
		s.hidden.clear();
		expect(paths(await s.search({ query: "secret" }))).toEqual([
			"decisions/c.md",
		]);
		await s.close();
	});

	it("indexes an edited note again and forgets a deleted one", async () => {
		const s = await setup();
		await s.note("journal/2026-10-28.md", "old words");
		expect(paths(await s.search({ query: "old" }))).toHaveLength(1);
		await s.note("journal/2026-10-28.md", "new words");
		expect(paths(await s.search({ query: "old" }))).toEqual([]);
		expect(paths(await s.search({ query: "new" }))).toHaveLength(1);
		await s.remove("journal/2026-10-28.md");
		expect(paths(await s.search({ query: "new" }))).toEqual([]);
		await s.close();
	});

	it("filters by type and path, keeps k results and orders equal scores by path", async () => {
		const s = await setup();
		for (const p of ["lessons/b.md", "lessons/a.md", "entities/c.md"])
			await s.note(p, "same text");
		expect(paths(await s.search({ query: "same" }))).toEqual([
			"entities/c.md",
			"lessons/a.md",
			"lessons/b.md",
		]);
		expect(paths(await s.search({ query: "same", type: "lesson" }))).toEqual([
			"lessons/a.md",
			"lessons/b.md",
		]);
		expect(paths(await s.search({ query: "same", path: "entities/" }))).toEqual(
			["entities/c.md"],
		);
		const two = await s.search({ query: "same", k: 2 });
		expect(two.ok && two.value.results.map((h) => h.sources.keyword)).toEqual([
			1, 2,
		]);
		await s.close();
	});

	it("finds a note that holds any word of the query, the one with more of them first (ADR-151)", async () => {
		const s = await setup();
		await s.note("lessons/one.md", "mockup colors");
		await s.note("lessons/both.md", "mockup prices in TL");
		await s.note("lessons/none.md", "nothing here");
		expect(paths(await s.search({ query: "mockup prices" }))).toEqual([
			"lessons/both.md",
			"lessons/one.md",
		]);
		await s.close();
	});

	it("answers no vault with nothing and refuses the personal vault and a query of no word", async () => {
		const s = await setup();
		expect(await s.search({ query: "x" })).toEqual(ok({ results: [] }));
		expect(paths(await s.search({ query: "x", scope: "personal" }))).toBe(
			"not_found",
		);
		expect(paths(await s.search({ query: "..." }))).toBe("bad_input");
		expect(paths(await s.search({ query: "x", k: 0 }))).toBe("bad_input");
		await s.close();
	});

	it("does not start without storage", async () => {
		const s = await setup();
		const r = await createKnowledgeSearchModule().activate(s.base);
		expect(r.ok ? "" : r.error.code).toBe("activation_failed");
		await s.close();
	});
});
