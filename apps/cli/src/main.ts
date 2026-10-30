import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { SecretStore } from "@mete/contracts";
import { globalDataDir, type Logger } from "@mete/kernel";
import { serveStdio, type Transport } from "@mete/mcp";
import { createScriptedModule } from "@mete/providers";
import { createKeychainStore } from "@mete/security";
import { auditCommand } from "./application/audit.js";
import { terminalAuthorize } from "./application/authorize.js";
import {
	eventsCommand,
	type Io,
	mcpCommand,
	type RunWhat,
	runCommand,
	statusCommand,
	stopCommand,
} from "./application/commands.js";
import { terminalConfirm } from "./application/confirm.js";
import { type DaemonStreams, daemonCommand } from "./application/daemon.js";
import { terminalElicit } from "./application/elicit.js";
import { keyCommand } from "./application/keys.js";
import { registryAddCommand, registryCommand } from "./application/registry.js";
import { removeCommand } from "./application/remove.js";
import { rollbackCommand } from "./application/rollback.js";
import { templateValidate } from "./application/templates.js";
import {
	ADAPTERS_DIR_ENV,
	SCRIPTED_CHAT_ENV,
	SCRIPTED_WEB_ENV,
	TEMPLATES_DIR_ENV,
} from "./defaults.js";
import { type App, type AppOptions, createApp } from "./infrastructure/app.js";
import { fileLogger } from "./infrastructure/log.js";
import {
	heldMessage,
	lockHolder,
	runLockFile,
	takeRunLock,
} from "./infrastructure/run-lock.js";
import { browserOf } from "./infrastructure/scripted-browser.js";
import { scriptedSecrets, scriptedWeb } from "./infrastructure/scripted-web.js";
import { USAGE } from "./usage.js";

// Entry of the mete binary (ARCHITECTURE.md, CLI): parses arguments and runs one command.

const OPTIONS = {
	resume: { type: "string" },
	template: { type: "string" },
	continue: { type: "boolean" },
	single: { type: "boolean" },
	run: { type: "boolean" },
	always: { type: "boolean" },
	all: { type: "boolean" },
	json: { type: "boolean" },
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

// A run command has a terminal, so an MCP server may ask the user a question, a model, or a sign-in through it.
const asking = (io: Io) => ({
	elicit: terminalElicit(io),
	confirm: terminalConfirm(io),
	authorize: terminalAuthorize(io),
});

const run = (opts: AppOptions, io: Io, what: RunWhat) =>
	!("goal" in what) || what.goal || what.continue
		? locked(opts, io, () =>
				withApp({ ...opts, ...asking(io) }, io, (a) => runCommand(a, io, what)),
			)
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

// mete allow <run id> [--run | --always] (ADR-121): once by default.
const allow = (opts: AppOptions, io: Io, p: Parsed, runId?: string) => {
	const { run: forRun, always } = p.values;
	if (!runId || (forRun && always)) return usage(io);
	const scope = always ? "always" : forRun ? "run" : "once";
	return run(opts, io, { allow: runId, scope });
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

// Restoring or removing changes files, so no run may start meanwhile: the lock of mete run (ADR-079, ADR-143).
const rollback = (reader: AppOptions, io: Io, runId?: string, n?: string) =>
	runId && n
		? locked(reader, io, () =>
				withApp(reader, io, (a) => rollbackCommand(a, io, runId, n)),
			)
		: usage(io);
const remove = (reader: AppOptions, io: Io, runId?: string) =>
	runId
		? locked(reader, io, () =>
				withApp(reader, io, (a) => removeCommand(a, io, runId)),
			)
		: usage(io);

// The folder a long-running command serves: the one it was given, or the current one.
const inFolder = (opts: AppOptions, folder?: string) => ({
	...opts,
	workspaceDir: folder ? resolve(opts.workspaceDir, folder) : opts.workspaceDir,
});

// The lock and recovery as for mete run: this process drives the runs it starts until the host leaves.
const mcp = (opts: AppOptions, io: Io, serve: Serve, folder?: string) => {
	const at = inFolder(opts, folder);
	return locked(at, io, async () => {
		const { transport, closed } = await serve();
		return withApp({ ...at, serve: transport }, io, (a) =>
			mcpCommand(a, io, at.workspaceDir, closed),
		);
	});
};

// The same lock and recovery as mete mcp; the streams open only once an engine is there to serve.
const daemon = (
	opts: AppOptions,
	io: Io,
	open: () => DaemonStreams,
	folder?: string,
) => {
	const at = inFolder(opts, folder);
	return locked(at, io, () =>
		withApp(at, io, (a) => daemonCommand(a, io, at.workspaceDir, open())),
	);
};

// mete registry search "<words>": read-only, like mete status.
const registry = (reader: AppOptions, io: Io, [sub, ...words]: string[]) => {
	const query = words.join(" ").trim();
	if (sub === "search" && query)
		return withApp(reader, io, (a) => registryCommand(a, io, query));
	const [name] = words;
	if (sub !== "add" || !name || words.length > 1) return usage(io);
	const target = {
		name,
		workspaceDir: reader.workspaceDir,
		fetch: reader.fetch ?? fetch,
	};
	return withApp(reader, io, (a) => registryAddCommand(a, io, target));
};

// The commands that only read the folder, like mete status: no run lock, no recovery.
const read = (
	reader: AppOptions,
	io: Io,
	[command, arg, more]: string[],
	json: boolean,
) => {
	if (command === "events" && arg)
		return withApp(reader, io, async (a) => eventsCommand(a, io, arg, json));
	if (command === "status")
		return withApp(reader, io, (a) => statusCommand(a, io, arg, json));
	if (command === "audit")
		return withApp(reader, io, async (a) => auditCommand(a, io, arg, json));
	if (command === "template" && arg === "validate")
		return withApp(reader, io, (a) => templateValidate(a.templates, io, more));
	return usage(io);
};

const dispatch = (
	p: Parsed,
	opts: AppOptions,
	io: Io,
	ends: Ends,
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
		case "allow":
			return allow(opts, io, p, rest[0]);
		case "events":
		case "status":
		case "template":
		case "audit":
			return read(reader, io, p.positionals, p.values.json === true);
		case "stop":
			return stop(reader, io, p.values.all ? "all" : rest[0]);
		case "rollback":
			return rollback(reader, io, rest[0], rest[1]);
		case "remove":
			return remove(reader, io, rest[0]);
		case "mcp":
			return mcp(opts, io, ends.serve, rest[0]);
		case "daemon":
			return daemon(opts, io, ends.daemon, rest[0]);
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

type Served = { transport: Transport; closed: Promise<void> };
type Serve = () => Served | Promise<Served>;

// The two ways a command talks to another program instead of the terminal.
type Ends = { readonly serve: Serve; readonly daemon: () => DaemonStreams };

const stdio = (): DaemonStreams => ({
	input: process.stdin,
	output: process.stdout,
});

/** Where the command runs; the rest is replaceable for tests. */
export type Env = {
	readonly cwd: string;
	readonly globalDir?: string;
	readonly logger?: Logger;
	readonly secrets?: SecretStore;
	/** A chat script the daemon answers from instead of every provider; docs/15, ADR-111. */
	readonly scriptedChat?: string;
	/** A web script the daemon answers search and page calls from; docs/15, ADR-116. */
	readonly scriptedWeb?: string;
	/** A browser script the daemon answers screenshots and audits from; docs/15, ADR-117. */
	readonly scriptedBrowser?: string;
	/** The built-in templates folder a packaged desktop ships beside the app; docs/15, ADR-115. */
	readonly templatesDir?: string;
	/** The level 2 mapping files folder a packaged desktop ships beside the app; docs/15, ADR-115. */
	readonly adaptersDir?: string;
	/** The transport `mete mcp` answers on; stdio by default. */
	readonly serve?: Serve;
	/** The streams `mete daemon` speaks on; stdio by default. */
	readonly daemon?: () => DaemonStreams;
};

/**
 * The folders a packaged desktop ships beside the app (ADR-115): an explicit Env value wins, then the
 * environment variable the desktop sets, then the repository-relative folder app.ts defaults to.
 */
export const foldersOf = (
	env: Pick<Env, "templatesDir" | "adaptersDir">,
	read: (name: string) => string | undefined = (name) => process.env[name],
) => ({
	templatesDir: env.templatesDir ?? read(TEMPLATES_DIR_ENV),
	adaptersDir: env.adaptersDir ?? read(ADAPTERS_DIR_ENV),
});

/**
 * The web answers and the keychain of a scripted app (ADR-116): an explicit Env value wins, then the
 * environment variable the desktop sets; unset, the tools reach the network with the keychain.
 */
export const webOf = (
	env: Pick<Env, "scriptedWeb">,
	read: (name: string) => string | undefined = (name) => process.env[name],
): { readonly fetch?: typeof fetch; readonly secrets?: SecretStore } => {
	const file = env.scriptedWeb ?? read(SCRIPTED_WEB_ENV);
	return file ? { fetch: scriptedWeb(file), secrets: scriptedSecrets() } : {};
};

// What the composition is built from for one command: the chat script (ADR-111), the web script
// (ADR-116), the browser script (ADR-117) and the packaged folders (ADR-115) replace their defaults
// only when they are set.
const appOptions = (
	env: Env,
	globalDir: string,
	logger: Logger,
): AppOptions => {
	const scripted = env.scriptedChat ?? process.env[SCRIPTED_CHAT_ENV];
	const folders = foldersOf(env);
	const web = webOf(env);
	const secrets = env.secrets ?? web.secrets;
	return {
		workspaceDir: env.cwd,
		globalDir,
		logger,
		...(secrets ? { secrets } : {}),
		...(scripted ? { providers: [createScriptedModule(scripted)] } : {}),
		...(web.fetch ? { fetch: web.fetch } : {}),
		...browserOf(env),
		...(folders.templatesDir ? { templatesDir: folders.templatesDir } : {}),
		...(folders.adaptersDir ? { adaptersDir: folders.adaptersDir } : {}),
	};
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
	return dispatch(parsed, appOptions(env, globalDir, logger), io, {
		serve: env.serve ?? serveStdio,
		daemon: env.daemon ?? stdio,
	});
};
