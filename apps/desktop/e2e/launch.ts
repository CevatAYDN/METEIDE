import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	type Browser,
	test as base,
	chromium,
	expect,
	type Page,
} from "@playwright/test";

// One launched app: the built Electron main, the downloaded plugins and a fresh git workspace,
// so a test sees the daemon, the panels and the extension host as a user does (docs/15).
// The package is CommonJS (ADR-002), so no import.meta: Playwright runs the tests from the
// config's folder, this package's root. The app is driven over its own remote-debugging port:
// @playwright/test's _electron wrapper does not see this app's window, connectOverCDP does.

const APP = resolve(process.cwd());
const MAIN = join(APP, "lib", "backend", "electron-main.js");
const REQUIRE = createRequire(join(APP, "package.json"));

/** The app under test: its page, the fresh workspace it opened, and how to stop it. */
export type Launch = {
	readonly page: Page;
	/** The fresh git workspace the app opened. */
	readonly dir: string;
	readonly close: () => Promise<void>;
};

/** The web answers a test app sees instead of the network (ADR-116). */
export type ScriptedWeb = {
	readonly results?: readonly {
		readonly title: string;
		readonly url: string;
		readonly snippet: string;
	}[];
	readonly pages?: Record<string, string>;
};

/** The browser answers a test app sees instead of Chromium (ADR-117). */
export type ScriptedBrowser = {
	readonly screenshots?: readonly {
		readonly width: number;
		readonly height: number;
	}[];
	readonly audits?: readonly object[];
};

/** What a test gives its app before launch (ADR-111): the workspace's files and the model's answers. */
export type MeteOptions = {
	/** Files the fresh workspace starts with, by relative path; a folder is made for each. */
	readonly files: Record<string, string>;
	/** Whether those files become a first commit, which a task's worktree starts from (docs/08). */
	readonly commit: boolean;
	/** The scripted model's turns, one array of chunks per call, the last repeating; an empty list means no scripted provider, and a quota narrows its unit so a flow can pause (ADR-113). */
	readonly script: {
		readonly turns: readonly (readonly object[])[];
		readonly quota?: {
			readonly limit?: number;
			readonly reset?: "sliding" | "fixed_daily" | "fixed_monthly";
		};
	};
	/** The web answers the app's tools get instead of the network; empty means the real tools (ADR-116). */
	readonly web: ScriptedWeb;
	/** The browser answers the app's tools get instead of Chromium; empty means the real tools (ADR-117). */
	readonly browserScript: ScriptedBrowser;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A port the OS gives for the moment, so parallel runs never collide on the debug port. */
const freePort = () =>
	new Promise<number>((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolvePort(port));
		});
	});

const frontendPage = (browser: Browser) =>
	browser
		.contexts()
		.flatMap((c) => c.pages())
		.find((p) => p.url().startsWith("file:"));

/** Theia asks whether the folder is trusted before anything else can be reached; a test answers yes. */
const trustWorkspace = async (page: Page) => {
	const yes = await page
		.$$("#theia-dialog-shell button")
		.then(async (buttons) => {
			for (const b of buttons)
				if (/yes, i trust/i.test((await b.textContent()) ?? "")) return b;
		});
	if (yes) await yes.click();
};

/** Whether the debugging endpoint lists the shell's page; a browser connected before it is blind to it. */
const frontendListed = async (port: number) => {
	try {
		const reply = await fetch(`http://127.0.0.1:${port}/json/list`, {
			signal: AbortSignal.timeout(2_000),
		});
		const targets = (await reply.json()) as { type?: string; url?: string }[];
		return targets.some(
			(t) => t.type === "page" && (t.url ?? "").startsWith("file:"),
		);
	} catch {
		return false;
	}
};

// The connection, once the endpoint answers; a failed attempt waits a second and tries again.
const connectOver = async (port: number): Promise<Browser | undefined> => {
	for (let i = 0; i < 60; i++) {
		try {
			return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		} catch {
			await sleep(1000);
		}
	}
	return undefined;
};

// The debugging endpoint answers as soon as Chromium runs, before the backend creates the window;
// a session connected that early stays blind to the page it creates, so the page's target comes
// first and only then the connection.
const waitForFrontend = async (
	port: number,
): Promise<{ browser: Browser; page: Page } | undefined> => {
	for (let i = 0; i < 120; i++) {
		if (await frontendListed(port)) break;
		await sleep(1000);
	}
	const browser = await connectOver(port);
	if (!browser) return undefined;
	for (let i = 0; i < 30; i++) {
		const page = frontendPage(browser);
		if (page) return { browser, page };
		await sleep(1000);
	}
	return undefined;
};

/** Kills the app's whole process tree, so the next test's instance takes the single-instance lock. */
const killTree = (pid: number | undefined) => {
	if (!pid) return;
	spawnSync(
		process.platform === "win32" ? "taskkill" : "kill",
		process.platform === "win32"
			? ["/pid", String(pid), "/T", "/F"]
			: ["-TERM", String(pid)],
	);
};

// Windows may keep a file of a killed app's workspace locked for a moment (its daemon's database),
// so the folder is removed with a few retries instead of failing the test after it passed.
const removeDir = async (dir: string) => {
	for (let i = 0; i < 10; i++) {
		try {
			rmSync(dir, { recursive: true, force: true });
			return;
		} catch {
			await sleep(300);
		}
	}
	rmSync(dir, { recursive: true, force: true });
};

const startApp = async (workspace: string, env: NodeJS.ProcessEnv) => {
	const port = await freePort();
	const child = spawn(
		String(REQUIRE("electron")),
		[
			MAIN,
			`--remote-debugging-port=${port}`,
			`--plugins=local-dir:${join(APP, "plugins")}`,
			workspace,
		],
		{ stdio: ["ignore", "ignore", "pipe"], env },
	);
	// The output is not asserted; it answers why a launch that opens no window ended.
	let tail = "";
	child.stderr.on("data", (chunk: Buffer | string) => {
		tail = `${tail}${chunk}`.slice(-2000);
	});
	return { port, child, tail: () => tail };
};

const writeFiles = (root: string, files: Record<string, string>) => {
	for (const [name, text] of Object.entries(files)) {
		const path = join(root, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	}
};

// A task's worktree starts from a commit (docs/08), so a flow that uses one needs a first one; the
// identity is the run's own, which the repository may not have configured for the test's user.
const commitFiles = (root: string) => {
	spawnSync("git", ["add", "-A"], { cwd: root });
	spawnSync(
		"git",
		[
			"-c",
			"user.name=METE",
			"-c",
			"user.email=mete@example.invalid",
			"commit",
			"--quiet",
			"-m",
			"the test's first files",
		],
		{ cwd: root },
	);
};

// The chat answers live in a file outside the workspace (ADR-111), so they join no checkpoint; the
// turns travel in an object because Playwright unwraps an array-shaped option one level (ADR-113).
const scriptOf = (script: MeteOptions["script"]) => {
	if (script.turns.length === 0) return undefined;
	const dir = mkdtempSync(join(tmpdir(), "mete-e2e-chat-"));
	const file = join(dir, "chat.json");
	const body = script.quota
		? { turns: script.turns, quota: script.quota }
		: script.turns;
	writeFileSync(file, JSON.stringify(body));
	return { dir, file };
};

// The app's own global folder: the daemon keeps quota usage, logs and settings under %APPDATA%\METE
// (XDG_DATA_HOME on Linux), and a test must never read or write the developer's (ADR-113); nor
// Theia's ~/.theia, where each test's workspace would stay as a recent and a trusted folder.
const globalEnv = (dir: string): NodeJS.ProcessEnv => ({
	THEIA_CONFIG_DIR: join(dir, "theia"),
	...(process.platform === "win32" ? { APPDATA: join(dir, "appdata") } : {}),
	...(process.platform === "linux"
		? { XDG_DATA_HOME: join(dir, "data"), XDG_CONFIG_HOME: join(dir, "config") }
		: {}),
});

// The web answers travel the same way as the chat script (ADR-116): a file outside the workspace, so
// they join no checkpoint. An empty script means the app keeps the real web tools.
const webScriptOf = (web: ScriptedWeb) => {
	const empty =
		(web.results?.length ?? 0) === 0 &&
		Object.keys(web.pages ?? {}).length === 0;
	if (empty) return undefined;
	const dir = mkdtempSync(join(tmpdir(), "mete-e2e-web-"));
	const file = join(dir, "web.json");
	writeFileSync(file, JSON.stringify(web));
	return { dir, file };
};

// The browser answers too (ADR-117): a file outside the workspace, so they join no checkpoint.
const browserScriptOf = (browser: ScriptedBrowser) => {
	const empty =
		(browser.screenshots?.length ?? 0) === 0 &&
		(browser.audits?.length ?? 0) === 0;
	if (empty) return undefined;
	const dir = mkdtempSync(join(tmpdir(), "mete-e2e-browser-"));
	const file = join(dir, "browser.json");
	writeFileSync(file, JSON.stringify(browser));
	return { dir, file };
};

// The app's environment: its own global folder and the scripts, which live outside the workspace
// (ADR-111, ADR-116, ADR-117).
const envOf = (
	global: string,
	scripts: {
		readonly chat?: { readonly file: string };
		readonly web?: { readonly file: string };
		readonly browser?: { readonly file: string };
	},
): NodeJS.ProcessEnv => ({
	...process.env,
	...globalEnv(global),
	...(scripts.chat ? { METE_SCRIPTED_CHAT: scripts.chat.file } : {}),
	...(scripts.web ? { METE_SCRIPTED_WEB: scripts.web.file } : {}),
	...(scripts.browser ? { METE_SCRIPTED_BROWSER: scripts.browser.file } : {}),
});

export const test = base.extend<MeteOptions & { mete: Launch }>({
	files: [{}, { option: true }],
	commit: [false, { option: true }],
	script: [{ turns: [] }, { option: true }],
	web: [{}, { option: true }],
	browserScript: [{}, { option: true }],
	mete: async ({ files, commit, script, web, browserScript }, use) => {
		if (!existsSync(MAIN))
			throw new Error(
				"the app is not built: run pnpm build, pnpm --filter @mete/desktop bundle and download:plugins first",
			);
		const workspace = mkdtempSync(join(tmpdir(), "mete-e2e-"));
		spawnSync("git", ["init", "--quiet"], { cwd: workspace });
		writeFiles(workspace, files);
		if (commit) commitFiles(workspace);
		const chat = scriptOf(script);
		const webScript = webScriptOf(web);
		const browserFile = browserScriptOf(browserScript);
		const global = mkdtempSync(join(tmpdir(), "mete-e2e-home-"));
		const env = envOf(global, {
			...(chat ? { chat } : {}),
			...(webScript ? { web: webScript } : {}),
			...(browserFile ? { browser: browserFile } : {}),
		});
		const { port, child, tail } = await startApp(workspace, env);
		const stop = async (browser?: Browser) => {
			await browser?.close().catch(() => undefined);
			killTree(child.pid);
			await removeDir(workspace);
			await removeDir(global);
			if (chat) await removeDir(chat.dir);
			if (webScript) await removeDir(webScript.dir);
			if (browserFile) await removeDir(browserFile.dir);
		};
		const front = await waitForFrontend(port);
		if (!front) {
			await stop();
			throw new Error(`the app did not open its window: ${tail()}`);
		}
		const { browser, page } = front;
		await page.bringToFront();
		// The shell must be up and focused before any keyboard shortcut reaches it; the first
		// shortcut right after the shell appears is lost while keybindings still arm.
		await page.waitForSelector("#theia-app-shell", { timeout: 60_000 });
		await page.click("body");
		await sleep(2000);
		await trustWorkspace(page);
		await use({ page, dir: workspace, close: () => stop(browser) });
		await stop(browser);
	},
});

export { expect };

/** Starts a run from the composer, the keyboard-first way docs/13 asks every METE action to be reachable. */
export const startRun = async (
	page: Page,
	{ goal, team }: { readonly goal: string; readonly team: RegExp },
) => {
	await runCommand(page, "METE: Start run");
	const field = page.locator("textarea.mete-field");
	await expect(field).toBeVisible({ timeout: 60_000 });
	const radio = page.getByRole("radio", { name: team });
	await expect(radio).toBeVisible({ timeout: 60_000 });
	await field.fill(goal);
	await radio.check();
	await page.getByRole("button", { name: "Start run" }).click();
};

/** The Home inbox's row whose goal opens the run in the Team panel (ADR-110). */
export const inboxLink = (page: Page, goal: string) =>
	page
		.locator('section[aria-label="Waiting for you"]')
		.filter({ has: page.getByTitle("Open in the team panel") })
		.getByTitle("Open in the team panel")
		.filter({ hasText: goal });

/** The file a run's artifact landed in, under `.mete/artifacts/`, once a task wrote it. */
export const artifactPath = (dir: string, name: string): string | undefined => {
	const artifacts = join(dir, ".mete", "artifacts");
	if (!existsSync(artifacts)) return undefined;
	for (const runId of readdirSync(artifacts)) {
		const file = join(artifacts, runId, name);
		if (existsSync(file)) return file;
	}
	return undefined;
};

/** Runs a command from Theia's palette, the keyboard-first way docs/13 asks every METE action to be reachable. */
export const runCommand = async (page: Page, label: string) => {
	const input = page.locator(".quick-input-box input");
	for (let i = 0; i < 3; i++) {
		await page.keyboard.press("Control+Shift+P");
		const opened = await input
			.waitFor({ state: "visible", timeout: 5_000 })
			.then(() => true)
			.catch(() => false);
		if (opened) break;
		await page.click("body");
	}
	// The quick input does not take focus by itself, and it filters on real key events only.
	await input.click();
	await page.keyboard.type(label, { delay: 40 });
	await page.keyboard.press("Enter");
};
