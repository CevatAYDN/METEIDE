import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The Windows NSIS installer (docs/15, builds; ADR-115): `pnpm deploy` stages the app with a real
// node_modules tree, the build outputs and the folders the packaged app reads are copied in, and
// electron-builder packs that staging folder as its project. Run it after
// `pnpm --filter @mete/desktop bundle`.

const app = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(app, "..", "..");
const BUILDER = join(app, "node_modules", "electron-builder", "cli.js");
const output = join(app, "dist", "installer");

const run = (command, args, cwd) => {
	const r = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
		// Only a bare `pnpm` (a .cmd shim on Windows) needs a shell; node runs directly, which keeps
		// Node 24's DEP0190 warning about shell arguments away. The arguments travel as an array.
		shell: process.platform === "win32" && command === "pnpm",
	});
	if (r.error) console.error(r.error.message);
	if (r.status !== 0) process.exit(r.status ?? 1);
};

// The packaged app needs the built shell and the downloaded plugins; say what is missing instead of
// shipping a folder without them.
for (const [needed, first] of [
	["lib/backend/electron-main.js", "pnpm --filter @mete/desktop bundle"],
	["plugins", "pnpm --filter @mete/desktop download:plugins"],
	["node_modules/electron-builder", "pnpm install --frozen-lockfile"],
])
	if (!existsSync(join(app, needed))) {
		console.error(`${needed} is missing: run ${first} first`);
		process.exit(1);
	}

// `pnpm deploy --prod` records production-only settings in the repository's install state, after
// which every pnpm command here asks to reinstall without devDependencies; the file is put back.
const STATE = join(root, "node_modules", ".pnpm-workspace-state-v1.json");
const state = existsSync(STATE) ? readFileSync(STATE) : undefined;

const stage = mkdtempSync(join(tmpdir(), "mete-stage-"));
try {
	const pnpm = process.env.npm_execpath;
	// --legacy: this workspace is not injected, which pnpm's default deploy asks for (pnpm v10+).
	// --ignore-scripts: native modules are compiled by electron-builder's npmRebuild for Electron's
	// ABI instead, so the Node-ABI build deploy would run is thrown away (docs/15, builds).
	const deploy = [
		"--filter",
		"@mete/desktop",
		"deploy",
		"--prod",
		"--legacy",
		"--ignore-scripts",
		stage,
	];
	run(
		pnpm ? process.execPath : "pnpm",
		pnpm ? [pnpm, ...deploy] : deploy,
		root,
	);

	// The staging folder is electron-builder's project root, so everything the app ships lives in
	// it: the deploy's package.json and node_modules, the built shell, the plugins and the folders
	// the CLI finds beside a packaged app (the `extraResources` of electron-builder.yml), and
	// `build/`, electron-builder's build resources folder that holds the application icon.
	// The workspace file keeps pnpm's collectors on this folder instead of an enclosing workspace.
	writeFileSync(join(stage, "pnpm-workspace.yaml"), "packages: []\n");
	for (const [from, to] of [
		[join(app, "lib"), join(stage, "lib")],
		[join(app, "plugins"), join(stage, "plugins")],
		[join(root, "templates"), join(stage, "templates")],
		[join(root, "adapters"), join(stage, "adapters")],
		[join(app, "build"), join(stage, "build")],
	])
		cpSync(from, to, { recursive: true });

	run(
		process.execPath,
		[
			BUILDER,
			"--win",
			"nsis",
			"--x64",
			"--projectDir",
			stage,
			"-c",
			join(app, "electron-builder.yml"),
			`--config.directories.output=${output}`,
		],
		app,
	);
} finally {
	if (state) writeFileSync(STATE, state);
	rmSync(stage, { recursive: true, force: true });
}
