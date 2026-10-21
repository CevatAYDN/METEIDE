import { homedir } from "node:os";
import { parseArgs } from "node:util";
import type { SecretStore } from "@mete/contracts";
import { globalDataDir, type Logger } from "@mete/kernel";
import { createKeychainStore } from "@mete/security";
import {
	type Io,
	keyCommand,
	runCommand,
	statusCommand,
	stopCommand,
} from "./application/commands.js";
import { type App, type AppOptions, createApp } from "./infrastructure/app.js";
import { fileLogger } from "./infrastructure/log.js";
import {
	heldMessage,
	lockHolder,
	runLockFile,
	takeRunLock,
} from "./infrastructure/run-lock.js";

// Entry of the mete binary (ARCHITECTURE.md, CLI): parses arguments and runs one command.

const USAGE = [
	"usage:",
	'  mete run "<goal>"            run a single agent on the goal in this folder',
	"  mete run --resume <run id>   resume a paused run",
	"  mete status [<run id>]       list the runs of this folder",
	"  mete stop <run id> | --all   cancel paused runs",
	"  mete key set|delete <provider id>, mete key list",
].join("\n");

const OPTIONS = {
	resume: { type: "string" },
	all: { type: "boolean" },
	help: { type: "boolean", short: "h" },
} as const;

type Parsed = ReturnType<
	typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>;

// Every command but key needs the app: the kernel and modules of this workspace.
const withApp = async (
	opts: AppOptions,
	io: Io,
	use: (app: App) => Promise<number>,
) => {
	const app = await createApp(opts);
	if (!app.ok) {
		for (const e of app.error) io.err(`${e.file} ${e.path}: ${e.reason}`);
		return 1;
	}
	try {
		return await use(app.value);
	} finally {
		await app.value.stop();
	}
};

// Recovery runs when core-engine activates, so the lock is taken before the app exists.
const locked = async (opts: AppOptions, io: Io, use: () => Promise<number>) => {
	const lock = await takeRunLock(runLockFile(opts.workspaceDir));
	if (!lock.ok) {
		io.err(lock.error);
		return 1;
	}
	try {
		return await use();
	} finally {
		await lock.value();
	}
};

// A run held by a live mete run is cancelled with Ctrl+C there, never from here.
const unlessDriven = async (
	opts: AppOptions,
	io: Io,
	use: () => Promise<number>,
) => {
	const file = runLockFile(opts.workspaceDir);
	const pid = await lockHolder(file);
	if (pid === undefined) return use();
	io.err(heldMessage(pid, file));
	return 1;
};

const dispatch = (
	p: Parsed,
	opts: AppOptions,
	io: Io,
): Promise<number> | number => {
	const [command, ...rest] = p.positionals;
	const reader = { ...opts, recover: false };
	const goal = rest.join(" ").trim();
	switch (command) {
		case "run": {
			const resume = p.values.resume;
			const what = resume ? { resume } : { goal };
			return resume || goal
				? locked(opts, io, () =>
						withApp(opts, io, (a) => runCommand(a, io, what)),
					)
				: usage(io);
		}
		case "status":
			return withApp(reader, io, (a) => statusCommand(a, io, rest[0]));
		case "stop": {
			const target = p.values.all ? "all" : rest[0];
			return target
				? unlessDriven(reader, io, () =>
						withApp(reader, io, (a) => stopCommand(a, io, target)),
					)
				: usage(io);
		}
		case "key":
			return keyCommand(
				opts.secrets ?? createKeychainStore(),
				io,
				rest[0],
				rest[1],
			);
		default:
			return usage(io, p.values.help === true);
	}
};

const usage = (io: Io, asked = false) => {
	(asked ? io.out : io.err)(USAGE);
	return asked ? 0 : 1;
};

/** Where the command runs; the rest is replaceable for tests. */
export type Env = {
	readonly cwd: string;
	readonly globalDir?: string;
	readonly logger?: Logger;
	readonly secrets?: SecretStore;
};

/** Runs one command for `argv` (without node and the script) and returns the exit code. */
export const main = async (
	argv: readonly string[],
	io: Io,
	env: Env = { cwd: process.cwd() },
): Promise<number> => {
	let parsed: Parsed;
	try {
		parsed = parseArgs({
			args: [...argv],
			options: OPTIONS,
			allowPositionals: true,
		});
	} catch (e) {
		io.err(e instanceof Error ? e.message : String(e));
		return usage(io);
	}
	const globalDir =
		env.globalDir ?? globalDataDir(process.env, process.platform, homedir());
	const logger = env.logger ?? fileLogger(globalDir);
	const secrets = env.secrets ? { secrets: env.secrets } : {};
	return dispatch(
		parsed,
		{ workspaceDir: env.cwd, globalDir, logger, ...secrets },
		io,
	);
};
