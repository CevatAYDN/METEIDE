import { describe, expect, it } from "vitest";
import { CHUNK_CHARS } from "../src/defaults.js";
import { ftsQuery, noteFacts, sectionsOf } from "../src/domain/index-text.js";

// How a vault note becomes rows of the keyword index (docs/11, Hybrid search; ADR-149).

describe("sectionsOf", () => {
	it("makes one row per heading section, with the text before the first heading as its own", () => {
		const body =
			"Intro line.\n\n# Title\n\n## Why\nBecause.\n\n## Empty\n\n### Code\n```\n# not a heading\n```\n";
		expect(sectionsOf(body)).toEqual([
			{ text: "Intro line." },
			{ heading: "Title", text: "" },
			{ heading: "Why", text: "Because." },
			{ heading: "Empty", text: "" },
			{ heading: "Code", text: "```\n# not a heading\n```" },
		]);
		expect(sectionsOf("#tag is no heading")).toEqual([
			{ text: "#tag is no heading" },
		]);
		expect(sectionsOf("  \n")).toEqual([]);
	});

	it("splits a section over 1,000 tokens at a line break, losing no text", () => {
		const line = `${"a".repeat(99)}\n`;
		const text = line.repeat(90).trim();
		const rows = sectionsOf(`## Long\n${text}`);
		expect(rows.length).toBe(3);
		for (const r of rows) {
			expect(r.heading).toBe("Long");
			expect(r.text.length).toBeLessThanOrEqual(CHUNK_CHARS);
		}
		expect(rows.map((r) => r.text).join("\n")).toBe(text);
		const unbroken = sectionsOf("b".repeat(CHUNK_CHARS + 1));
		expect(unbroken.map((r) => r.text.length)).toEqual([CHUNK_CHARS, 1]);
	});
});

describe("noteFacts", () => {
	it("takes the title from the frontmatter, else the first # heading, else the file name", () => {
		const body = "Intro\n## Sub\n# Real title\n";
		expect(noteFacts("lessons/a.md", { title: "Given" }, body)?.title).toBe(
			"Given",
		);
		expect(noteFacts("lessons/a.md", {}, body)?.title).toBe("Real title");
		expect(noteFacts("lessons/write-tests.md", {}, "text")?.title).toBe(
			"write-tests",
		);
	});

	it("takes the type from the frontmatter, else from the folder, and leaves the rest out", () => {
		expect(noteFacts("inbox/a.md", { type: "lesson" }, "")?.type).toBe(
			"lesson",
		);
		expect(noteFacts("entities/a.md", { type: "meeting" }, "")?.type).toBe(
			"entity",
		);
		expect(noteFacts("inbox/a.md", {}, "")?.type).toBe("inbox");
		expect(noteFacts("readme.md", {}, "")).toBeUndefined();
		expect(noteFacts("other/a.md", {}, "")).toBeUndefined();
		expect(noteFacts("lessons/a.md", { private: true }, "")).toBeUndefined();
	});
});

describe("ftsQuery", () => {
	it("makes each word a phrase, so the caller's text is never FTS5 syntax", () => {
		expect(ftsQuery("  kahve  fiyatı ")).toBe('"kahve" "fiyatı"');
		expect(ftsQuery('a"b OR c*')).toBe('"a""b" "OR" "c*"');
		expect(ftsQuery("... ?!")).toBeUndefined();
	});
});
