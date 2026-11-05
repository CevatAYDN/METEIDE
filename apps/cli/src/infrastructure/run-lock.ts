import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { err, ok, type Result } from "@mete/contracts";

// One `mete run` drives a workspace at a time (ARCHITECTURE.md, CLI): a file holding its pid and program.

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

/** The program a live pid runs, as the lock file names it; undefined when it cannot be read. */
export type ProgramOf = (pid: number) => string | undefined;

// This process's program, written beside its pid so a pid the system gave to another program after
// a crash is not taken for the holder.
const PROGRAM = basename(process.execPath).toLowerCase();

// tasklist's CSV starts with the image name; Linux keeps the first 15 characters in comm.
const programOf: ProgramOf = (pid) => {
	try {
		if (process.platform === "win32") {
			const out = execFileSync(
				"tasklist",
				["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
				{ encoding: "utf8", windowsHide: true },
			);
			return /^"([^"]+)"/.exec(out.trim())?.[1]?.toLowerCase();
		}
		if (process.platform === "linux")
			return readFileSync(`/proc/${pid}/comm`, "utf8").trim().toLowerCase();
		return undefined;
	} catch {
		return undefined;
	}
};

/** The pid of the live process holding the lock, or undefined when it is free or stale. */
// A program that cannot be read, or a lock that names none, counts as the holder: refusing is safe.
export const lockHolder = async (file: string, program = programOf) =>
	holderOf(await lockText(file), program);

const lockText = (file: string) => readFile(file, "utf8").catch(() => "");

const holderOf = (text: string, program: ProgramOf) => {
	const [first = "", name] = text.split("\n").map((l) => l.trim());
	const pid = Number.parseInt(first, 10);
	if (!(pid > 0 && alive(pid))) return undefined;
	const now = name ? program(pid) : undefined;
	if (now === undefined || !name) return pid;
	return now === name || (now.length === 15 && name.startsWith(now))
		? pid
		: undefined;
};

const create = (file: string) =>
	writeFile(file, `${process.pid}\n${PROGRAM}\n`, { flag: "wx" }).then(
		() => true,
		(e: NodeJS.ErrnoException) => {
			if (e.code === "EEXIST") return false;
			throw e;
		},
	);

/** The refusal shown when a live `mete run` holds the workspace. */
export const heldMessage = (pid: number, file: string) =>
	`another mete command (pid ${pid}: run, mcp or daemon) drives this workspace; press Ctrl+C there, or delete ${file} if that process is not mete`;

/** What `takeRunLock` reads the lock file through; a test hooks it to simulate a race. */
export type LockDeps = {
	readonly read: (file: string) => Promise<string>;
};

// Up to 3 looks at a stale lock: a fresh one written between the judgement and the rm must survive.
const TRIES = 3;

// A stale lock is removed only while its text is still the text judged stale; a different text
// means another process replaced it meanwhile, so the loop judges that one instead.
const replaceStale = async (file: string, stale: string, deps: LockDeps) => {
	if ((await deps.read(file)) !== stale) return false;
	await rm(file, { force: true });
	return true;
};

/** Takes the lock, replacing a stale one; refuses while a live process holds it. */
export const takeRunLock = async (
	file: string,
	deps: LockDeps = { read: lockText },
): Promise<Result<Release, string>> => {
	try {
		await mkdir(dirname(file), { recursive: true });
		for (let attempt = 0; attempt < TRIES; attempt++) {
			if (await create(file)) return ok(() => rm(file, { force: true }));
			const text = await deps.read(file);
			const pid = holderOf(text, programOf);
			if (pid !== undefined) return err(heldMessage(pid, file));
			await replaceStale(file, text, deps);
		}
		return err(`${file} was taken while it was being replaced; try again`);
	} catch (e) {
		return err(`${file}: ${e instanceof Error ? e.message : String(e)}`);
	}
};
