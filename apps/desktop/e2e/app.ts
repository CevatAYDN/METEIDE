import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

// Which app the end-to-end tests start (ADR-124): the repository's build, or the packaged app in
// dist/installer/win-unpacked when METE_E2E_APP is packaged. The package is CommonJS (ADR-002), so
// no import.meta: Playwright runs the tests from the config's folder, this package's root.

const APP = resolve(process.cwd());
const REQUIRE = createRequire(join(APP, "package.json"));
const MAIN = join(APP, "lib", "backend", "electron-main.js");
const UNPACKED = join(APP, "dist", "installer", "win-unpacked");
const EXE = join(UNPACKED, "METE IDE.exe");
export const PACKAGED = process.env.METE_E2E_APP === "packaged";
const PLUGINS = PACKAGED
	? join(UNPACKED, "resources", "app", "plugins")
	: join(APP, "plugins");

/** Why the app under test is missing, or nothing when it is there. */
export const missingApp = (): string | undefined => {
	if (existsSync(PACKAGED ? EXE : MAIN)) return undefined;
	return PACKAGED
		? "the packaged app is not built: run pnpm --filter @mete/desktop package:win first"
		: "the app is not built: run pnpm build, pnpm --filter @mete/desktop bundle and download:plugins first";
};

/** The command and arguments that start the app under test on a debugging port. */
export const appCommand = (
	port: number,
	workspace: string,
	userData: string,
): [string, string[]] => [
	PACKAGED ? EXE : String(REQUIRE("electron")),
	[
		...(PACKAGED ? [] : [MAIN]),
		// Electron finds its data folder (window state, single-instance lock) through Windows' known
		// folder, not APPDATA, so a test would open at the size the developer's own window was left at.
		`--user-data-dir=${userData}`,
		`--remote-debugging-port=${port}`,
		`--plugins=local-dir:${PLUGINS}`,
		workspace,
	],
];
