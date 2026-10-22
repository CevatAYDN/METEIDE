import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@mete/contracts";

// One `mete run` drives a workspace at a time (ARCHITECTURE.md, CLI): a file holding its pid.

/** Frees the lock. */
export type Release = () => Promise<void>;

/** The lock file of a workspace; `.mete/cache/` is git-ignored by the config loader. */
export const runLockFile = (workspaceDir: string) =>
	join(workspaceDir, ".mete", "cache", "run.lock");

// EPERM: the process exists but belongs to another user.
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
};

/** The pid of the live process holding the lock, or undefined when it is free or stale. */
// shortcut: a pid reused after a crash reads as alive; the refusal names the file to delete.
export const lockHolder = async (file: string) => {
	const text = await readFile(file, "utf8").catch(() => "");
	const pid = Number.parseInt(text, 10);
	return pid > 0 && alive(pid) ? pid : undefined;
};

const create = (file: string) =>
	writeFile(file, `${process.pid}\n`, { flag: "wx" }).then(
		() => true,
		(e: NodeJS.ErrnoException) => {
			if (e.code === "EEXIST") return false;
			throw e;
		},
	);

/** The refusal shown when a live `mete run` holds the workspace. */
export const heldMessage = (pid: number, file: string) =>
	`another mete command (pid ${pid}: run, mcp or daemon) drives this workspace; press Ctrl+C there, or delete ${file} if that process is not mete`;

/** Takes the lock, replacing a stale one; refuses while a live process holds it. */
export const takeRunLock = async (
	file: string,
): Promise<Result<Release, string>> => {
	try {
		await mkdir(dirname(file), { recursive: true });
		for (let attempt = 0; attempt < 2; attempt++) {
			if (await create(file)) return ok(() => rm(file, { force: true }));
			const pid = await lockHolder(file);
			if (pid !== undefined) return err(heldMessage(pid, file));
			await rm(file, { force: true });
		}
		return err(`${file} was taken while it was being replaced; try again`);
	} catch (e) {
		return err(`${file}: ${e instanceof Error ? e.message : String(e)}`);
	}
};
