// The desktop's performance measurement (docs/15, Performance budgets): launch the built app on
// this repository — the daily case — a few times, time each phase of the start, and measure the
// whole app process tree (backend, renderer, gpu, plugin host and what it starts) once the
// frontend has settled. Run with `pnpm --filter @mete/desktop test:perf` after build, bundle and
// download:plugins; METE_PERF_RUNS (default 3) sets how many launches to measure.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const RUNS = Number(process.env.METE_PERF_RUNS ?? 3);
const APP = resolve(process.cwd());
const ROOT = resolve(APP, "..", ".."); // this repository, the workspace the baseline describes
const MAIN = join(APP, "lib", "backend", "electron-main.js");
const REQUIRE = createRequire(join(APP, "package.json"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (ns) => [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)];

const freePort = () =>
	new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolvePort(port));
		});
	});

/** Every process below `pid`, with name and the head of its command line, one PowerShell round trip. */
const treeBelow = (pid) => {
	const out = spawnSync(
		"powershell",
		[
			"-NoProfile",
			"-Command",
			"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine | ConvertTo-Json -Compress",
		],
		{ encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
	).stdout;
	const rows = JSON.parse(out || "[]");
	const list = Array.isArray(rows) ? rows : [rows];
	const byParent = new Map();
	for (const r of list) {
		if (!byParent.has(r.ParentProcessId)) byParent.set(r.ParentProcessId, []);
		byParent.get(r.ParentProcessId).push(r);
	}
	const below = [];
	const walk = (id) => {
		for (const r of byParent.get(id) ?? []) {
			below.push(r);
			walk(r.ProcessId);
		}
	};
	walk(pid);
	return below.map((r) => ({
		name: r.Name,
		mb: Math.round(Number(r.WorkingSetSize) / 1048576),
		cmd: String(r.CommandLine ?? "")
			.replace(/^.*?electron\.exe["']?\s*/i, "")
			.replace(/^.*?node\.exe["']?\s*/i, "")
			.slice(0, 70),
	}));
};

/** Waits for the app's remote-debugging endpoint. */
const connectTo = async (port) => {
	for (let i = 0; i < 90; i++) {
		try {
			return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		} catch {
			await sleep(1000);
		}
	}
	throw new Error("the app did not open its debugging port");
};

/** Waits for the frontend page inside the connected browser. */
const frontendOf = async (browser) => {
	for (let i = 0; i < 90; i++) {
		const page = browser
			.contexts()
			.flatMap((c) => c.pages())
			.find((p) => p.url().startsWith("file:"));
		if (page) return page;
		await sleep(1000);
	}
	throw new Error("the app did not open its window");
};

/** Theia asks whether the folder is trusted; the measurement answers yes. */
const answerTrust = async (page) => {
	await page.click("body");
	for (const b of await page.$$("#theia-dialog-shell button")) {
		if (/yes, i trust/i.test((await b.textContent()) ?? "")) await b.click();
	}
};

/** Waits until the app's own log says every frontend contribution has settled. */
const waitSettled = async (child) => {
	for (let i = 0; i < 120; i++) {
		if (child.exitCode !== null) throw new Error("the app closed early");
		await sleep(1000);
		if (child.settled) return;
	}
	throw new Error("the frontend did not settle in 120 s");
};

/** One launch: phase timings in seconds and the settled tree. */
const runOnce = async () => {
	if (!existsSync(MAIN))
		throw new Error(
			"the app is not built: bundle first (apps/desktop/README.md)",
		);
	const t0 = Date.now();
	const at = () => (Date.now() - t0) / 1000;
	const port = await freePort();
	const child = spawn(String(REQUIRE("electron")), [
		MAIN,
		`--remote-debugging-port=${port}`,
		`--plugins=local-dir:${join(APP, "plugins")}`,
		ROOT,
	]);
	child.settled = false;
	const pipe = (d) => {
		if (
			/All frontend contributions settled|startup sequence completed/i.test(
				String(d),
			)
		)
			child.settled = true;
	};
	child.stdout.on("data", pipe);
	child.stderr.on("data", pipe);
	try {
		const browser = await connectTo(port);
		const connected = at();
		const page = await frontendOf(browser);
		await page.waitForSelector("#theia-app-shell", { timeout: 120_000 });
		const shell = at();
		await answerTrust(page);
		await waitSettled(child);
		await sleep(3000);
		const tree = treeBelow(child.pid);
		await browser.close().catch(() => undefined);
		return { connected, shell, settled: at(), tree };
	} finally {
		spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
	}
};

const runs = [];
for (let i = 0; i < RUNS; i++) {
	const r = await runOnce();
	runs.push(r);
	const mb = r.tree.reduce((n, p) => n + p.mb, 0);
	console.log(
		`run ${i + 1}: shell ${r.shell.toFixed(1)} s, settled ${r.settled.toFixed(1)} s, tree ${mb} MB in ${r.tree.length} processes`,
	);
}
const last = runs.at(-1);
console.log("\nmedians");
console.log(
	`  shell visible: ${median(runs.map((r) => r.shell)).toFixed(1)} s`,
);
console.log(
	`  contributions settled: ${median(runs.map((r) => r.settled)).toFixed(1)} s`,
);
console.log(
	`  process tree: ${median(runs.map((r) => r.tree.reduce((n, p) => n + p.mb, 0)))} MB`,
);
console.log(
	"\nprocess tree of the last run (docs/15 records it as the idle memory baseline)",
);
for (const p of last.tree)
	console.log(`  ${String(p.mb).padStart(4)} MB  ${p.name}  ${p.cmd}`);
