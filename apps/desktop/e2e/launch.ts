import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
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

/** What a test gives its app before launch (ADR-111): the workspace's files and the model's answers. */
export type MeteOptions = {
	/** Files the fresh workspace starts with, by relative path; a folder is made for each. */
	readonly files: Record<string, string>;
	/** The scripted model's turns, one array of chunks per call, the last repeating; an empty list means no scripted provider. */
	readonly script: { readonly turns: readonly (readonly object[])[] };
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

/** Waits for the app's remote-debugging endpoint, then for the frontend page inside it. */
const waitForFrontend = async (
	port: number,
): Promise<{ browser: Browser; page: Page } | undefined> => {
	let browser: Browser | undefined;
	for (let i = 0; i < 120 && !browser; i++) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		} catch {
			await sleep(1000);
		}
	}
	for (let i = 0; i < 120 && browser; i++) {
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

// The scripted provider reads its answers from a file outside the workspace (ADR-111), so the app's
// own changes stay out of the run's checkpoints; the file goes when the app does.
// The turns travel in an object: Playwright unwraps an array-shaped option one level.
const scriptOf = (turns: MeteOptions["script"]["turns"]) => {
	if (turns.length === 0) return undefined;
	const dir = mkdtempSync(join(tmpdir(), "mete-e2e-chat-"));
	const file = join(dir, "chat.json");
	writeFileSync(file, JSON.stringify(turns));
	return { dir, file };
};

export const test = base.extend<MeteOptions & { mete: Launch }>({
	files: [{}, { option: true }],
	script: [{ turns: [] }, { option: true }],
	mete: async ({ files, script }, use) => {
		if (!existsSync(MAIN))
			throw new Error(
				"the app is not built: run pnpm build, pnpm --filter @mete/desktop bundle and download:plugins first",
			);
		const workspace = mkdtempSync(join(tmpdir(), "mete-e2e-"));
		spawnSync("git", ["init", "--quiet"], { cwd: workspace });
		writeFiles(workspace, files);
		const chat = scriptOf(script.turns);
		const env = {
			...process.env,
			...(chat ? { METE_SCRIPTED_CHAT: chat.file } : {}),
		};
		const { port, child, tail } = await startApp(workspace, env);
		const stop = async (browser?: Browser) => {
			await browser?.close().catch(() => undefined);
			killTree(child.pid);
			await removeDir(workspace);
			if (chat) await removeDir(chat.dir);
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
