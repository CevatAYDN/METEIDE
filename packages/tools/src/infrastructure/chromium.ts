import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@mete/contracts";
import { chromium } from "playwright-core";
import {
	CHROMIUM_INSTALL_TIMEOUT_MS,
	RUNNER_STDERR_CHARS,
} from "../defaults.js";

// Chromium for the browser module, installed by Playwright's own installer on first use; it does
// not go through runtime.ensure@1, which hash-checks every download (docs/10).

/** Whether Chromium is there, and how to install it; the tests pass a fake. */
export type Chromium = {
	readonly installed: () => boolean;
	readonly install: (signal: AbortSignal) => Promise<Result<void, string>>;
};

const CLI = join(
	dirname(
		createRequire(import.meta.url).resolve("playwright-core/package.json"),
	),
	"cli.js",
);

const run = (signal: AbortSignal) =>
	new Promise<Result<void, string>>((resolve) => {
		const child = spawn(process.execPath, [CLI, "install", "chromium"], {
			stdio: ["ignore", "ignore", "pipe"],
			signal: AbortSignal.any([
				signal,
				AbortSignal.timeout(CHROMIUM_INSTALL_TIMEOUT_MS),
			]),
		});
		let tail = "";
		child.stderr?.on("data", (c: Buffer) => {
			tail = (tail + c.toString()).slice(-RUNNER_STDERR_CHARS);
		});
		child.on("error", (e) =>
			resolve(err(`installing Chromium failed: ${e.message}`)),
		);
		child.on("exit", (code) =>
			resolve(
				code === 0
					? ok(undefined)
					: err(
							`installing Chromium failed with exit code ${code}; stderr: ${tail.trim()}`,
						),
			),
		);
	});

/** Playwright's Chromium; concurrent installs share one run. */
export const playwrightChromium = (): Chromium => {
	let pending: Promise<Result<void, string>> | undefined;
	return {
		installed: () => existsSync(chromium.executablePath()),
		install: (signal) => {
			pending ??= run(signal).finally(() => {
				pending = undefined;
			});
			return pending;
		},
	};
};
