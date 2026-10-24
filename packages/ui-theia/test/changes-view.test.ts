import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	type ChangesModel,
	ChangesView,
	changeWord,
	countText,
} from "../src/application/changes-view.js";
import { DIFF_LINES } from "../src/defaults.js";

// The Changes panel rendered to HTML on Node (ADR-100): the words a changed file shows, the list of
// a working tree, and the diff of the row that is picked.

const html = (model: ChangesModel) =>
	renderToStaticMarkup(
		createElement(ChangesView, {
			model,
			controls: { onPick: () => {}, onRefresh: () => {}, onOpen: () => {} },
		}),
	);

const files = (
	list: readonly {
		path: string;
		change: "added" | "modified" | "deleted" | "renamed" | "untracked";
	}[],
	diff?: string,
): ChangesModel => ({
	kind: "files",
	changes: {
		vcs: true,
		branch: "main",
		files: [...list],
		...(diff === undefined ? {} : { diff }),
	},
});

describe("the Changes panel", () => {
	it("names each change in plain words", () => {
		expect(changeWord("added")).toBe("Added");
		expect(changeWord("modified")).toBe("Changed");
		expect(changeWord("deleted")).toBe("Deleted");
		expect(changeWord("renamed")).toBe("Renamed");
		expect(changeWord("untracked")).toBe("New");
	});

	it("counts the files in words", () => {
		expect(countText(1)).toBe("1 changed file");
		expect(countText(3)).toBe("3 changed files");
	});

	it("lists a file per row with its word and path", () => {
		const out = html(
			files([
				{ path: "src/a.ts", change: "modified" },
				{ path: "src/b.ts", change: "untracked" },
			]),
		);
		expect(out).toContain("2 changed files");
		expect(out).toContain(" · main");
		expect(out).toContain(">Changed<");
		expect(out).toContain(">New<");
		expect(out).toContain(">src/a.ts<");
		expect(out).toContain(">src/b.ts<");
	});

	it("marks the picked row and draws its diff", () => {
		const out = html({
			kind: "files",
			picked: "src/a.ts",
			changes: {
				vcs: true,
				branch: "main",
				files: [
					{ path: "src/a.ts", change: "modified" },
					{ path: "src/b.ts", change: "added" },
				],
				diff: "-old\n+new\n",
			},
		});
		expect(out).toContain('aria-pressed="true"');
		expect(out).toContain('class="mete-diff-line del"');
		expect(out).toContain('class="mete-diff-line add"');
	});

	it("says a clean folder has no changes", () => {
		expect(html(files([]))).toContain("No changes.");
	});

	it("says a folder is not a repository, or that one must be opened", () => {
		expect(html({ kind: "no_git" })).toContain("not a git repository");
		expect(html({ kind: "no_folder" })).toContain("Open a folder");
	});

	it("cuts a long diff and says how many lines it left out", () => {
		const long = Array.from(
			{ length: DIFF_LINES + 2 },
			(_, i) => `+line ${i}`,
		).join("\n");
		const out = html({
			...files([{ path: "a.ts", change: "modified" }], long),
			picked: "a.ts",
		} as ChangesModel);
		expect(out).toContain("2 more lines");
	});

	it("offers to open the picked file in the editor", () => {
		const out = html({
			kind: "files",
			picked: "src/a.ts",
			changes: {
				vcs: true,
				branch: "main",
				files: [{ path: "src/a.ts", change: "modified" }],
				diff: "+new\n",
			},
		});
		expect(out).toContain(">Open file<");
	});

	it("offers open for an untracked file, which has no diff to read", () => {
		const out = html({
			kind: "files",
			picked: "src/new.ts",
			changes: {
				vcs: true,
				branch: "main",
				files: [{ path: "src/new.ts", change: "untracked" }],
			},
		});
		expect(out).toContain(">Open file<");
	});

	it("offers nothing to open for a deleted file, whose path is gone", () => {
		const out = html({
			kind: "files",
			picked: "src/gone.ts",
			changes: {
				vcs: true,
				branch: "main",
				files: [{ path: "src/gone.ts", change: "deleted" }],
				diff: "-old\n",
			},
		});
		expect(out).not.toContain(">Open file<");
	});
});
