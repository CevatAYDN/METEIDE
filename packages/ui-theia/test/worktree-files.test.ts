import type URI from "@theia/core/lib/common/uri";
import { describe, expect, it } from "vitest";
import { hidden, ranked } from "../src/application/worktree-files.js";
import {
	type ShowFilesDeps,
	showWorktreeFiles,
} from "../src/infrastructure/worktree-files.js";

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

describe("Show files (ADR-132)", () => {
	it("opens the picked file and keeps no tab of it across restarts, since the worktree goes when its task lands (ADR-140)", async () => {
		const tab = { storeState: () => ({ props: {} }), restoreState: () => {} };
		const opened: string[] = [];
		const deps = {
			files: {
				resolve: async () => ({
					children: [{ name: "index.html", isDirectory: false }],
				}),
			},
			quick: { pick: async <T>(items: T[]) => items[0] },
			openers: {
				getOpener: async () => ({
					open: async (uri: URI) => {
						opened.push(uri.path.base);
						return tab;
					},
				}),
			},
			messages: { info: async () => undefined, warn: async () => undefined },
		} as unknown as ShowFilesDeps;
		await showWorktreeFiles(deps, "/w/tree");
		expect(opened).toEqual(["index.html"]);
		expect(tab.storeState()).toBeUndefined();
	});

	it("offers the files the request lists, pages first, without walking the folder, and an empty list as nothing to show (ADR-141)", async () => {
		const offered: string[][] = [];
		const said: string[] = [];
		const deps = {
			files: {
				resolve: async () => {
					throw new Error("walked");
				},
			},
			quick: {
				pick: async (items: { label: string }[]) => {
					offered.push(items.map((i) => i.label));
					return undefined;
				},
			},
			messages: {
				info: async (m: string) => void said.push(m),
				warn: async (m: string) => void said.push(m),
			},
		} as unknown as ShowFilesDeps;
		await showWorktreeFiles(deps, "/w/tree", ["styles.css", "index.html"]);
		await showWorktreeFiles(deps, "/w/tree", []);
		expect(offered).toEqual([["index.html", "styles.css"]]);
		expect(said).toEqual(["This task has no files to show."]);
	});
});
