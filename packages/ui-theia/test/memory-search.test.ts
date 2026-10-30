import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MemorySearch } from "../src/application/memory-search.js";
import { type MemoryItem, MemoryView } from "../src/application/memory-view.js";

// The Memory screen's search (docs/13, Knowledge; ADR-159): a labelled box over the notes, the hits
// best first with their heading and snippet and Open, and words for searching, no hit and a failure.

const note: MemoryItem = {
	path: "lessons/a.md",
	type: "lesson",
	title: "Write collision tests early",
	tags: [],
	private: false,
	url: "file:///w/.mete/knowledge/lessons/a.md",
};

const html = (search?: MemorySearch) =>
	renderToStaticMarkup(
		createElement(MemoryView, {
			model: { kind: "notes", notes: [note] },
			search,
			onOpen: () => {},
			onRefresh: () => {},
			onNewRun: () => {},
			onSearch: () => {},
		}),
	);

describe("the Memory screen's search", () => {
	it("offers a labelled search box above the notes", () => {
		const out = html();
		expect(out).toContain('<search><form class="mete-memory-search"');
		expect(out).toContain('<label for="mete-memory-query"');
		expect(out).toContain("Search memory");
		expect(out).toContain("Write collision tests early");
	});

	it("lists the hits in place of the notes, with heading, snippet and Open", () => {
		const out = html({
			kind: "hits",
			query: "floor",
			hits: [
				{
					path: "lessons/a.md",
					type: "lesson",
					title: "Write collision tests early",
					heading: "Why",
					snippet: "The player fell through the floor",
					url: "file:///w/.mete/knowledge/lessons/a.md",
				},
			],
		});
		expect(out).toContain("1 found for “floor”");
		expect(out).toContain("Lesson · Why");
		expect(out).toContain("The player fell through the floor");
		expect(out).toContain('aria-label="Open Write collision tests early"');
		expect(out).not.toContain(">All 1<");
	});

	it("says when it searches, finds nothing or fails", () => {
		expect(html({ kind: "searching", query: "x" })).toContain("Searching…");
		expect(html({ kind: "hits", query: "ship", hits: [] })).toContain(
			"Nothing found for “ship”",
		);
		expect(
			html({ kind: "failed", query: "x", message: "the daemon stopped" }),
		).toContain('role="alert">the daemon stopped<');
	});
});
