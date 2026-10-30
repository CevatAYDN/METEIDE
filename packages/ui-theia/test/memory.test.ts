import { describe, expect, it } from "vitest";
import { noteOf, sortNotes, typeCounts } from "../src/domain/memory.js";

// The Memory screen's notes (docs/13, Knowledge; ADR-159): docs/11's title and type, the date,
// tags, source and private mark, newest first.

const LESSON = `---
type: lesson
title: Write collision tests early
created: 2026-10-21T10:00:00Z
updated: 2026-10-22T09:00:00Z
source: run/1a2b3c4d-0000-4000-8000-000000000000
tags: [testing, game-studio]
private: true
---

# Ignored heading

Body.
`;

describe("noteOf", () => {
	it("reads the frontmatter's title, type, date, tags, source and private mark", () => {
		expect(noteOf("lessons/write-collision-tests-early.md", LESSON)).toEqual({
			path: "lessons/write-collision-tests-early.md",
			type: "lesson",
			title: "Write collision tests early",
			at: "2026-10-22T09:00:00Z",
			tags: ["testing", "game-studio"],
			source: "run/1a2b3c4d-0000-4000-8000-000000000000",
			private: true,
		});
	});

	it("takes the first # heading, then the file name, and the folder's type", () => {
		expect(
			noteOf("journal/2026-10-30.md", "## Run\n# Day one\ntext", 0),
		).toMatchObject({
			type: "journal",
			title: "Day one",
			at: "1970-01-01T00:00:00.000Z",
			tags: [],
			private: false,
		});
		expect(noteOf("decisions/use-vite.md", "no heading")).toMatchObject({
			type: "decision",
			title: "use-vite",
		});
	});

	it("leaves out a note with no type, as the search index does", () => {
		expect(noteOf("preferences.md", "# Mine")).toBeUndefined();
		expect(noteOf("other/x.md", "---\ntype: recipe\n---\n# X")).toBeUndefined();
	});

	it("keeps going when the frontmatter does not parse or has odd values", () => {
		expect(
			noteOf("lessons/a.md", "---\ntitle: [\n---\n# A", undefined),
		).toMatchObject({ type: "lesson", title: "A", tags: [] });
		expect(
			noteOf("inbox/b.md", "---\ntitle: 3\ntags: x\nprivate: yes\n---\n# B"),
		).toMatchObject({ type: "inbox", title: "B", tags: [], private: false });
	});
});

describe("sortNotes and typeCounts", () => {
	it("puts the newest first and undated notes last, and counts each type", () => {
		const notes = [
			noteOf("lessons/old.md", "---\nupdated: 2026-10-01\n---\n# Old"),
			noteOf("journal/none.md", "# None"),
			noteOf("lessons/new.md", "---\nupdated: 2026-10-29\n---\n# New"),
		].filter((n) => n !== undefined);
		expect(sortNotes(notes).map((n) => n.title)).toEqual([
			"New",
			"Old",
			"None",
		]);
		expect(typeCounts(notes)).toEqual({
			decision: 0,
			lesson: 2,
			entity: 0,
			journal: 1,
			inbox: 0,
		});
	});
});
