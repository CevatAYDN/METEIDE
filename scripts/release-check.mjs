// The release check of docs/15 (Release process, step 2): every release-tier check of the test
// table, run in turn and reported once. A step that fails, cannot run or is not built yet fails the
// check; nothing is skipped silently. Run it with `pnpm release:check`; it downloads tools.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

// The Electron the desktop ships, so Electronegativity judges its defaults, not v0.1.0's.
const ELECTRON = JSON.parse(
	readFileSync(join(ROOT, "apps", "desktop", "package.json"), "utf8"),
).devDependencies.electron;

// Electronegativity exits 0 whatever it finds; a HIGH finding fails the step, like a high audit
// finding (docs/15), unless docs/15 names it as an exception with its reason.
const EXCEPTIONS = new Set([
	// Theia 1.76 blocks will-navigate and limits window.open with setWindowOpenHandler for every
	// web contents (electron-main.js); the 2023 check looks for the removed new-window event only.
	"LIMIT_NAVIGATION_GLOBAL_CHECK",
]);

const findings = (csv) => {
	const rows = csv.trim().split("\n").slice(1);
	const high = rows
		.filter((r) => r.split(",")[1] === '"HIGH"')
		.map((r) => r.split(",")[0])
		.filter((id) => !EXCEPTIONS.has(id));
	const summary = `${rows.length} finding(s), ${high.length} high outside the docs/15 exceptions`;
	return high.length === 0
		? { status: "pass", reason: summary }
		: { status: "fail", reason: `${summary}: ${high.join(", ")}` };
};

const electronegativity = () => {
	const out = mkdtempSync(join(tmpdir(), "mete-electronegativity-"));
	const report = join(out, "report.csv");
	try {
		const r = viaPnpm(
			[
				"--silent",
				`--package=${ELECTRONEGATIVITY}`,
				"dlx",
				"electronegativity",
				"-i",
				join(ROOT, "apps", "desktop", "lib", "backend"),
				"-e",
				ELECTRON,
				"-o",
				report,
			],
			15,
		);
		return r.status === "pass" ? findings(readFileSync(report, "utf8")) : r;
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
};

// The licenses docs/05 allows in what ships (ADR-066); EPL-2.0 and LGPL-2.1+ are for Theia and its
// dependencies, CC0, CC-BY-4.0 and OFL-1.1 for assets and fonts, which a package list cannot tell
// from code.
const ALLOWED = new Set([
	"MIT",
	"Apache-2.0",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"0BSD",
	"ISC",
	"MPL-2.0",
	"Unlicense",
	"BlueOak-1.0.0",
	"Python-2.0",
	"EPL-2.0",
	"LGPL-2.1+",
	"LGPL-2.1-or-later",
	"CC0-1.0",
	"CC-BY-4.0",
	"OFL-1.1",
]);

// An SPDX expression passes when one OR choice has only allowed licenses; a WITH exception keeps
// the license it extends. shortcut: parentheses are dropped, so "(A OR B) AND C" reads as
// "A OR B AND C"; pnpm lists none such today, parse the grammar when one comes.
const allowed = (expression) =>
	expression
		.replace(/[()]/g, "")
		.split(" OR ")
		.some((choice) =>
			choice
				.split(" AND ")
				.every((l) => ALLOWED.has(l.split(" WITH ")[0].trim())),
		);
assert.equal(
	allowed("EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0"),
	true,
);
assert.equal(allowed("(OFL-1.1 AND MIT)"), true);
assert.equal(allowed("(MIT AND GPL-3.0)"), false);
assert.equal(allowed("LGPL-3.0-only"), false);

// Each license outside the list, with the packages under it.
const licenses = () => {
	const r = spawnSync(
		process.execPath,
		[PNPM, "licenses", "list", "--prod", "--json"],
		{
			cwd: ROOT,
			encoding: "utf8",
			timeout: 5 * MINUTE,
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	if (r.status !== 0)
		return {
			status: "fail",
			reason:
				tail(`${r.stdout}
${r.stderr}`) || `exit code ${r.status}`,
		};
	const outside = Object.entries(JSON.parse(r.stdout))
		.filter(([license]) => !allowed(license))
		.map(
			([license, pkgs]) => `${license} (${pkgs.map((p) => p.name).join(", ")})`,
		);
	return outside.length === 0
		? { status: "pass", reason: "" }
		: {
				status: "fail",
				reason: `not allowed by docs/05: ${outside.join("; ")}`,
			};
};

// shortcut: the scan arguments follow osv-scanner's documentation and were not run here, because it
// was not installed; check them the first time it is.
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
	["licenses of what ships", licenses],
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
