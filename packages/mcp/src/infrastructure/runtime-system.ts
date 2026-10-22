import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { err, ok, type Result } from "@mete/contracts";

// What the runtime manager asks of the machine (docs/10, Managed runtimes); tests pass a fake.

export type RuntimeSystem = {
	/** The folder on PATH that holds `command`, if any. */
	readonly which: (command: string) => string | undefined;
	/** What `command --version` prints, such as v22.1.0; undefined when it does not run. */
	readonly version: (
		command: string,
		signal: AbortSignal,
	) => Promise<string | undefined>;
	/** Extracts a .zip, .tar.gz or .tgz archive into dir with the system tar. */
	readonly extract: (
		archive: string,
		dir: string,
		signal: AbortSignal,
	) => Promise<Result<void, string>>;
};

const WIN = process.platform === "win32";

const which = (command: string) => {
	const exts = WIN ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
	const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
	return dirs.find((d) => exts.some((e) => existsSync(join(d, command + e))));
};

const exec = (file: string, args: string[], signal: AbortSignal) =>
	new Promise<Result<string, string>>((resolve) => {
		execFile(file, args, { signal, windowsHide: true }, (e, stdout, stderr) =>
			resolve(e ? err(`${e.message} ${stderr}`.trim()) : ok(stdout.trim())),
		);
	});

// bsdtar ships with Windows 10 and reads .zip; a tar earlier on PATH (Git's GNU tar) cannot.
// shortcut: GNU tar on Linux reads no zip, so .zip and .mcpb binaries fail there; upgrade when a zip reader is chosen.
const TAR = WIN
	? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
	: "tar";

export const runtimeSystem: RuntimeSystem = {
	which,
	version: async (command, signal) => {
		const r = await exec(command, ["--version"], signal);
		return r.ok ? r.value : undefined;
	},
	extract: async (archive, dir, signal) => {
		const r = await exec(TAR, ["-xf", archive, "-C", dir], signal);
		return r.ok ? ok(undefined) : r;
	},
};
