import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

/** The app under test: its page and how to stop it. */
export type Launch = {
	readonly page: Page;
	readonly close: () => Promise<void>;
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
	for (let i = 0; i < 60 && !browser; i++) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		} catch {
			await sleep(1000);
		}
	}
	for (let i = 0; i < 60 && browser; i++) {
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

const startApp = async (workspace: string) => {
	const port = await freePort();
	const child = spawn(
		String(REQUIRE("electron")),
		[
			MAIN,
			`--remote-debugging-port=${port}`,
			`--plugins=local-dir:${join(APP, "plugins")}`,
			workspace,
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	// shortcut: the app's own output is not asserted here; a failure shows up as no page below.
	child.stderr.on("data", () => undefined);
	return { port, child };
};

export const test = base.extend<{ mete: Launch }>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright insists on the destructured fixtures argument, and this fixture uses none of them.
	mete: async ({}, use) => {
		if (!existsSync(MAIN))
			throw new Error(
				"the app is not built: run pnpm build, pnpm --filter @mete/desktop bundle and download:plugins first",
			);
		const workspace = mkdtempSync(join(tmpdir(), "mete-e2e-"));
		spawnSync("git", ["init", "--quiet"], { cwd: workspace });
		const { port, child } = await startApp(workspace);
		const stop = async (browser?: Browser) => {
			await browser?.close().catch(() => undefined);
			killTree(child.pid);
			rmSync(workspace, { recursive: true, force: true });
		};
		const front = await waitForFrontend(port);
		if (!front) {
			await stop();
			throw new Error("the app did not open its window");
		}
		const { browser, page } = front;
		await page.bringToFront();
		// The shell must be up and focused before any keyboard shortcut reaches it; the first
		// shortcut right after the shell appears is lost while keybindings still arm.
		await page.waitForSelector("#theia-app-shell", { timeout: 60_000 });
		await page.click("body");
		await sleep(2000);
		await trustWorkspace(page);
		await use({ page, close: () => stop(browser) });
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
