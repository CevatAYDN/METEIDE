import { describe, expect, it } from "vitest";
import { hidden, ranked } from "../src/application/worktree-files.js";

describe("the files of a task's worktree the human can open (ADR-132)", () => {
	it("puts pages first, then the rest by name", () => {
		expect(
			ranked(["notes.md", "design/index.html", "DESIGN.md", "a.HTML"]),
		).toEqual(["a.HTML", "design/index.html", "DESIGN.md", "notes.md"]);
	});

	it("hides what is not the task's work", () => {
		expect([".git", "node_modules", ".mete", "design"].filter(hidden)).toEqual([
			".git",
			"node_modules",
			".mete",
		]);
	});
});
