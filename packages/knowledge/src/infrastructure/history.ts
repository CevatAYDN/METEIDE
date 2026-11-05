import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@mete/contracts";
import { notePath, stampOf, VAULT, versionPath } from "../domain/note.js";

// A workspace vault note's versions in .history/, and bringing one back (docs/11, Aging and restore;
// ADR-173). `mete vault restore` is the person's own command, so it reads and writes the files itself.

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

const failed = (e: unknown) => (e instanceof Error ? e.message : String(e));

const inVault = (path: string): Result<string, string> => {
	const p = notePath(path);
	return p ? ok(p) : err(`${path} is not a .md note inside ${VAULT}/`);
};

/** The stamps of a note's versions, newest first; none when it has no history. */
export const versionsOf = async (
	workspaceDir: string,
	path: string,
): Promise<Result<string[], string>> => {
	const at = inVault(path);
	if (!at.ok) return at;
	const dir = join(workspaceDir, VAULT, ".history", at.value);
	try {
		const names = await readdir(dir);
		const stamps = names.map((n) => n.replace(/\.md$/, ""));
		return ok(
			stamps
				.filter((s) => STAMP.test(s))
				.sort()
				.reverse(),
		);
	} catch (e) {
		const gone = (e as NodeJS.ErrnoException).code === "ENOENT";
		return gone ? ok([]) : err(`${dir} cannot be read: ${failed(e)}`);
	}
};

// A workspace file's text, or undefined when there is none.
const textOf = (file: string) =>
	readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
		if (e.code === "ENOENT") return undefined;
		throw e;
	});

const put = async (file: string, text: string) => {
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, text, "utf8");
};

// The note as it is now goes to .history/ first, so a restore can be undone as well.
const swap = async (
	dir: string,
	path: string,
	version: string,
	now: string,
) => {
	const file = join(dir, VAULT, path);
	const current = await textOf(file);
	if (current === undefined) {
		await put(file, version);
		return undefined;
	}
	const kept = versionPath(path, now);
	await put(join(dir, kept), current);
	await put(file, version);
	return kept;
};

/** Brings a version of a note back as it was, after keeping the note as it is now. */
export const restoreVersion = async (
	workspaceDir: string,
	path: string,
	stamp: string,
	now: number,
): Promise<Result<{ readonly kept?: string }, string>> => {
	const at = inVault(path);
	if (!at.ok) return at;
	const p = at.value;
	const listed = await versionsOf(workspaceDir, p);
	if (!listed.ok) return listed;
	if (!listed.value.includes(stamp))
		return err(
			`${p} has no version ${stamp}; mete vault restore ${p} lists them`,
		);
	try {
		const version = await readFile(
			join(workspaceDir, versionPath(p, stamp)),
			"utf8",
		);
		const when = stampOf(new Date(now).toISOString());
		const kept = await swap(workspaceDir, p, version, when);
		return ok(kept ? { kept } : {});
	} catch (e) {
		return err(`${p} cannot be restored: ${failed(e)}`);
	}
};
