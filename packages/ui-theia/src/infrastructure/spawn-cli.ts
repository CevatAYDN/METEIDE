import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const CliManifest = z.object({ bin: z.object({ mete: z.string().min(1) }) });

// A packaged desktop ships templates/ and adapters/ as extra resources beside the app (ADR-115);
// the daemon then reads those instead of the repository's folders, which a packaged app lacks.
// The names match the CLI's defaults.ts constants.
const resourcesOf = () =>
	(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

/** The daemon's environment entries for a packaged app, from the folder its resources live in. */
export const packagedFolders = (
	resourcesPath: string | undefined = resourcesOf(),
): NodeJS.ProcessEnv => {
	if (!resourcesPath) return {};
	const templates = join(resourcesPath, "templates");
	const adapters = join(resourcesPath, "adapters");
	return {
		...(existsSync(templates) ? { METE_TEMPLATES_DIR: templates } : {}),
		...(existsSync(adapters) ? { METE_ADAPTERS_DIR: adapters } : {}),
	};
};

// The `mete` entry file of the installed @mete/cli package. The backend is bundled into
// apps/desktop/lib/backend, so the lookup starts there and apps/desktop depends on @mete/cli too.
const cliBin = () => {
	const manifest = require.resolve("@mete/cli/package.json");
	const { bin } = CliManifest.parse(JSON.parse(readFileSync(manifest, "utf8")));
	return join(dirname(manifest), bin.mete);
};

// A script on the Node of this process; inside Electron that is Electron's own Node, which
// ELECTRON_RUN_AS_NODE asks for (ARCHITECTURE.md, Daemon protocol). Arguments stay an array.
const spawnNode = (script: string, args: readonly string[], detached = false) =>
	spawn(process.execPath, [script, ...args], {
		env: {
			...process.env,
			...packagedFolders(),
			ELECTRON_RUN_AS_NODE: "1",
		},
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
		detached,
	});

/**
 * The daemon is started detached. On Windows a child that is not sits in its parent's job object,
 * which kills it the moment the desktop quits or crashes, before it can stop and free the run lock
 * (checked on Windows 11 under Node and Electron). Detached, it outlives the desktop, sees its input
 * close, which is its stop signal, and stops itself. It is never unref'd: the pipe is the leash.
 */
export const DAEMON_DETACHED = true;

/** Starts `mete daemon <folder>`. */
export const spawnCli = (workspaceDir: string) =>
	spawnNode(cliBin(), ["daemon", workspaceDir], DAEMON_DETACHED);

/** What a short `mete` command printed and how it ended. */
export type CliResult = {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
};

/** Runs a short command: `input` goes to its standard input, which then closes. */
export type RunCli = (
	args: readonly string[],
	input?: string,
) => Promise<CliResult>;

/** Runs a Node script to its end; the tests run a fake one, the backend `mete` itself. */
export const runScript = (
	script: string,
	args: readonly string[],
	input = "",
): Promise<CliResult> =>
	new Promise((resolve) => {
		const child = spawnNode(script, args);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d: Buffer | string) => {
			stdout += String(d);
		});
		child.stderr.on("data", (d: Buffer | string) => {
			stderr += String(d);
		});
		child.on("error", (e) =>
			resolve({ code: null, stdout, stderr: e.message }),
		);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.end(input);
	});

/** Runs `mete <args>`, for example `key list`. */
export const runCli: RunCli = (args, input) => runScript(cliBin(), args, input);
