import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { type JournalEntry, journalText } from "../domain/journal-text.js";

// The run reports' writes to the workspace vault's daily notes (docs/11, Run reports): METE's own,
// so they go to disk directly; an agent's journal note goes through the fs tools (ADR-145).

/** Why a journal note could not be written. */
export type JournalError = { readonly code: "io"; readonly message: string };

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
	entry: JournalEntry,
	now: string,
): Promise<Result<string, JournalError>> => {
	const dir = join(workspaceDir, ".mete", "knowledge", "journal");
	const file = join(dir, `${entry.day}.md`);
	try {
		await withLockRetry(() => mkdir(dir, { recursive: true }));
		const was = await readOrNone(file);
		const text = journalText(was, entry, now);
		await withLockRetry(() => writeFile(file, text, "utf8"));
	} catch (e) {
		return err({
			code: "io",
			message: e instanceof Error ? e.message : String(e),
		});
	}
	return ok(`.mete/knowledge/journal/${entry.day}.md`);
};
