import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	type MemoryItem,
	type MemoryModel,
	MemoryView,
	sourceText,
} from "../src/application/memory-view.js";

// The Memory screen (docs/13, Knowledge; ADR-159): the vault's notes newest first with their type,
// date, source, tags and private mark, type chips with counts, Open, and an empty state with New run.

const item = (over: Partial<MemoryItem> = {}): MemoryItem => ({
	path: "lessons/a.md",
	type: "lesson",
	title: "Write collision tests early",
	at: "2026-10-22T09:00:00Z",
	tags: ["testing"],
	source: "run/1a2b3c4d-0000-4000-8000-000000000000",
	private: false,
	url: "file:///w/.mete/knowledge/lessons/a.md",
	...over,
});

const html = (model: MemoryModel) =>
	renderToStaticMarkup(
		createElement(MemoryView, {
			model,
			onOpen: () => {},
			onRefresh: () => {},
			onNewRun: () => {},
			onSearch: () => {},
		}),
	);

describe("the Memory screen", () => {
	it("lists a note with its type, title, source, tags and Open, under type chips with counts", () => {
		const out = html({
			kind: "notes",
			notes: [
				item(),
				item({ path: "journal/d.md", type: "journal", title: "Day" }),
			],
		});
		expect(out).toContain("Write collision tests early");
		expect(out).toContain("From run 1a2b3c4d");
		expect(out).toContain(">testing<");
		expect(out).toContain('aria-label="Open Write collision tests early"');
		expect(out).toContain(">All 2<");
		expect(out).toContain(">Lessons 1<");
		expect(out).toContain(">Journal 1<");
		expect(out).not.toContain(">Decisions");
		expect(out).not.toContain("Private");
	});

	it("marks a private note", () => {
		expect(html({ kind: "notes", notes: [item({ private: true })] })).toContain(
			"Private",
		);
	});

	it("says where notes come from and offers New run when there are none", () => {
		const out = html({ kind: "notes", notes: [] });
		expect(out).toContain("No notes yet");
		expect(out).toContain(">New run<");
	});

	it("shows reading, no folder and a failure", () => {
		expect(html({ kind: "loading" })).toContain("Reading the memory");
		expect(html({ kind: "no_folder" })).toContain("Open a folder first");
		expect(html({ kind: "failed", message: "denied" })).toContain(
			'role="alert">denied<',
		);
	});
});

describe("sourceText", () => {
	it("names a run by its id's first 8 characters and the human as you", () => {
		expect(sourceText("run/1a2b3c4d-x")).toBe("From run 1a2b3c4d");
		expect(sourceText("human")).toBe("Written by you");
		expect(sourceText("import")).toBe("import");
		expect(sourceText(undefined)).toBeUndefined();
	});
});
