// The release check of docs/15 (Release process, step 2): every release-tier check of the test
// table, run in turn and reported once. A step that fails, cannot run or is not built yet fails the
// check; nothing is skipped silently. Run it with `pnpm release:check`; it downloads tools.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 1.10.3 is the newest release, published 2023-03-09, older than the 14 days docs/05 asks for.
const ELECTRONEGATIVITY = "@doyensec/electronegativity@1.10.3";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MINUTE = 60_000;

// biome-ignore lint/suspicious/noUndeclaredEnvVars: a root script pnpm runs, not a turbo task
const PNPM = process.env.npm_execpath;
if (!PNPM) throw new Error("run it through pnpm release:check");

const tail = (text) =>
	text.trim().split("\n").slice(-3).join(" / ").slice(0, 300);

const run = (command, args, minutes) => {
	const r = spawnSync(command, args, {
		cwd: ROOT,
		encoding: "utf8",
		timeout: minutes * MINUTE,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (r.error?.code === "ENOENT")
		return { status: "fail", reason: "not installed" };
	if (r.error) return { status: "fail", reason: r.error.message };
	if (r.status === 0) return { status: "pass", reason: "" };
	return {
		status: "fail",
		reason: tail(`${r.stdout}\n${r.stderr}`) || `exit code ${r.status}`,
	};
};

const viaPnpm = (args, minutes) =>
	run(process.execPath, [PNPM, ...args], minutes);

const electronegativity = () => {
	const out = mkdtempSync(join(tmpdir(), "mete-electronegativity-"));
	try {
		return viaPnpm(
			[
				"--silent",
				`--package=${ELECTRONEGATIVITY}`,
				"dlx",
				"electronegativity",
				"-i",
				join(ROOT, "apps", "desktop", "lib", "backend"),
				"-o",
				join(out, "report.csv"),
			],
			15,
		);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
};

const osvScanner = () => {
	const r = run(
		"osv-scanner",
		["scan", "--lockfile", join(ROOT, "pnpm-lock.yaml")],
		10,
	);
	return r.reason === "not installed"
		? {
				status: "fail",
				reason:
					"osv-scanner is not on PATH; install it from https://google.github.io/osv-scanner/",
			}
		: r;
};

const notBuilt = (what) => () => ({
	status: "not built",
	reason: `${what} is not built yet (docs/15)`,
});

const STEPS = [
	["pnpm check", () => viaPnpm(["check"], 20)],
	["all tests, contract kits included", () => viaPnpm(["test"], 30)],
	["chaos", () => viaPnpm(["test:chaos"], 15)],
	["MCP conformance", () => viaPnpm(["check:mcp"], 30)],
	[
		"audit, high and critical fail",
		() => viaPnpm(["audit", "--audit-level", "high"], 5),
	],
	["licenses of what ships", () => viaPnpm(["licenses", "list", "--prod"], 5)],
	["osv-scanner", osvScanner],
	["Electronegativity", electronegativity],
	[
		"desktop bundle",
		() => viaPnpm(["--filter", "@mete/desktop", "bundle"], 15),
	],
	[
		"Windows installer",
		notBuilt("the electron-builder configuration (a maintainer's decision)"),
	],
	["end-to-end (Playwright for Electron)", notBuilt("Playwright for Electron")],
	[
		"accessibility (axe-core in end-to-end)",
		notBuilt("axe-core inside the end-to-end tests"),
	],
];

const results = [];
for (const [name, step] of STEPS) {
	console.log(`… ${name}`);
	results.push({ name, ...step() });
}
console.log("\nrelease check");
for (const r of results)
	console.log(
		`${r.status.padEnd(9)} ${r.name}${r.reason ? `: ${r.reason}` : ""}`,
	);
const failed = results.filter((r) => r.status !== "pass").length;
console.log(
	failed === 0
		? "\nready to release"
		: `\n${failed} of ${results.length} steps did not pass`,
);
process.exitCode = failed === 0 ? 0 : 1;
