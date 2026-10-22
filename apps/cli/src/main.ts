import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { SecretStore } from "@mete/contracts";
import { globalDataDir, type Logger } from "@mete/kernel";
import { serveStdio, type Transport } from "@mete/mcp";
import { createKeychainStore } from "@mete/security";
import {
	eventsCommand,
	type Io,
	keyCommand,
	mcpCommand,
	type RunWhat,
	registryCommand,
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
	'  mete run "<goal>"            run the goal in this folder; the router picks a single agent or a team',
	'  mete run --single "<goal>"   run a single agent without asking the router',
	'  mete run --template <id> "<goal>"   run a team template on the goal',
	"  mete run --resume <run id>   resume a paused run",
	'  mete run --continue ["<goal>"]   go on from the last run\'s handoff',
	"  mete approve <run id> [<task id>]   approve a team task that waits for you",
	'  mete revise <run id> <task id> "<feedback>"   send it back with feedback',
	"  mete status [<run id>]       list the runs of this folder",
	"  mete events <run id>         show a run's history: time, event, module, task, agent",
	"  mete stop <run id> | --all   cancel paused runs",
	"  mete mcp [<folder>]          serve this folder's teams to an MCP host (Claude Code, Cursor, Cline)",
	'  mete registry search "<words>"   find MCP servers in the official MCP registry; installs nothing',
	"  mete key set|delete <provider id>, mete key list",
].join("\n");

const OPTIONS = {
	resume: { type: "string" },
	template: { type: "string" },
	continue: { type: "boolean" },
	single: { type: "boolean" },
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

const run = (opts: AppOptions, io: Io, what: RunWhat) =>
	!("goal" in what) || what.goal || what.continue
		? locked(opts, io, () => withApp(opts, io, (a) => runCommand(a, io, what)))
		: usage(io);

// mete approve <run id> [<task id>] and mete revise <run id> <task id> "<feedback>".
const answer = (
	opts: AppOptions,
	io: Io,
	[runId, taskId, ...words]: readonly string[],
	decision: "approve" | "revise",
) => {
	const feedback = words.join(" ").trim();
	if (!runId || (decision === "revise" && (!taskId || !feedback)))
		return usage(io);
	const input = {
		decision,
		...(taskId ? { taskId } : {}),
		...(feedback ? { feedback } : {}),
	};
	return run(opts, io, { approve: runId, input });
};

const goalOf = (p: Parsed, goal: string): RunWhat => {
	if (p.values.resume) return { resume: p.values.resume };
	const template = p.values.single
		? { templateId: null }
		: p.values.template
			? { templateId: p.values.template }
			: {};
	const more = p.values.continue ? { continue: true as const } : {};
	return { goal, ...template, ...more };
};

const stop = (reader: AppOptions, io: Io, target: string | undefined) =>
	target
		? unlessDriven(reader, io, () =>
				withApp(reader, io, (a) => stopCommand(a, io, target)),
			)
		: usage(io);

// The lock and recovery as for mete run: this process drives the runs it starts until the host leaves.
const mcp = (opts: AppOptions, io: Io, serve: Serve, folder?: string) => {
	const workspaceDir = folder
		? resolve(opts.workspaceDir, folder)
		: opts.workspaceDir;
	const at = { ...opts, workspaceDir };
	return locked(at, io, () => {
		const { transport, closed } = serve();
		return withApp({ ...at, serve: transport }, io, (a) =>
			mcpCommand(a, io, workspaceDir, closed),
		);
	});
};

// mete registry search "<words>": read-only, like mete status.
const registry = (reader: AppOptions, io: Io, [sub, ...words]: string[]) => {
	const query = words.join(" ").trim();
	return sub === "search" && query
		? withApp(reader, io, (a) => registryCommand(a, io, query))
		: usage(io);
};

const dispatch = (
	p: Parsed,
	opts: AppOptions,
	io: Io,
	serve: Serve,
): Promise<number> | number => {
	const [command, ...rest] = p.positionals;
	const reader = { ...opts, recover: false };
	const goal = rest.join(" ").trim();
	switch (command) {
		case "run":
			return run(opts, io, goalOf(p, goal));
		case "approve":
		case "revise":
			return answer(opts, io, rest, command);
		case "events":
			return rest[0]
				? withApp(reader, io, async (a) => eventsCommand(a, io, rest[0] ?? ""))
				: usage(io);
		case "status":
			return withApp(reader, io, (a) => statusCommand(a, io, rest[0]));
		case "stop":
			return stop(reader, io, p.values.all ? "all" : rest[0]);
		case "mcp":
			return mcp(opts, io, serve, rest[0]);
		case "registry":
			return registry(reader, io, rest);
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

type Serve = () => { transport: Transport; closed: Promise<void> };

/** Where the command runs; the rest is replaceable for tests. */
export type Env = {
	readonly cwd: string;
	readonly globalDir?: string;
	readonly logger?: Logger;
	readonly secrets?: SecretStore;
	/** The transport `mete mcp` answers on; stdio by default. */
	readonly serve?: Serve;
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
		env.serve ?? serveStdio,
	);
};
