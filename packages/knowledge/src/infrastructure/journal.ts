import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";

// The workspace vault's daily notes (docs/11, Vaults): `.mete/knowledge/journal/YYYY-MM-DD.md`, with
// the note frontmatter of docs/11 on the day's first section; each run report is appended to it.

/** Why a journal note could not be written. */
export type JournalError = { readonly code: "io"; readonly message: string };

const two = (n: number) => String(n).padStart(2, "0");

/** The local date of a moment, as the note's name. */
export const dayOf = (at: Date) =>
	`${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;

const frontmatter = (day: string, now: string, runId: string) =>
	[
		"---",
		"type: journal",
		`title: Journal ${day}`,
		`created: ${now}`,
		`updated: ${now}`,
		`source: run/${runId}`,
		"tags: []",
		"private: false",
		"pinned: false",
		"---",
		"",
		`# ${day}`,
		"",
	].join("\n");

const readOrNone = async (file: string) => {
	try {
		return await readFile(file, "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw e;
	}
};

/** Appends a section to the day's note, creating it first; answers its workspace-relative path. */
export const appendJournal = async (
	workspaceDir: string,
	entry: {
		readonly day: string;
		readonly runId: string;
		readonly section: string;
	},
	now: string,
): Promise<Result<string, JournalError>> => {
	const dir = join(workspaceDir, ".mete", "knowledge", "journal");
	const file = join(dir, `${entry.day}.md`);
	try {
		await withLockRetry(() => mkdir(dir, { recursive: true }));
		const was = await readOrNone(file);
		const head =
			was === undefined
				? frontmatter(entry.day, now, entry.runId)
				: `${was.replace(/^updated: .*$/m, `updated: ${now}`).trimEnd()}\n\n`;
		await withLockRetry(() => writeFile(file, head + entry.section, "utf8"));
	} catch (e) {
		return err({
			code: "io",
			message: e instanceof Error ? e.message : String(e),
		});
	}
	return ok(`.mete/knowledge/journal/${entry.day}.md`);
};
