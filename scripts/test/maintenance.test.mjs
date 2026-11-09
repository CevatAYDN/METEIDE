import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { processState, releaseScript, script } from "./maintenance-fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const RELEASE_GATES = [
	"pnpm check",
	"all tests, contract kits included",
	"chaos",
	"MCP conformance",
	"audit, high and critical fail",
	"licenses of what ships",
	"osv-scanner",
	"desktop bundle",
	"Electronegativity",
	"end-to-end (Playwright for Electron)",
	"accessibility (axe-core in end-to-end)",
	"Windows installer",
	"packaged app (onboarding and run flow)",
];

test("secret scan rejects a credential introduced only by a merge resolution", () => {
	const root = mkdtempSync(join(tmpdir(), "mete-secret-merge-"));
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
	try {
		git("init", "-b", "main");
		git("config", "user.email", "test@example.invalid");
		git("config", "user.name", "Test");
		writeFileSync(join(root, "base.txt"), "base");
		git("add", ".");
		git("commit", "-m", "base");
		const base = git("rev-parse", "HEAD").trim();
		git("checkout", "-b", "side");
		writeFileSync(join(root, "side.txt"), "side");
		git("add", ".");
		git("commit", "-m", "side");
		git("checkout", "main");
		writeFileSync(join(root, "main.txt"), "main");
		git("add", ".");
		git("commit", "-m", "main");
		git("merge", "--no-ff", "--no-commit", "side");
		const secret = `ghp_${"A1b2C3d4E5".repeat(3)}aBcDeF`;
		writeFileSync(join(root, "merge-only.txt"), secret);
		git("add", ".");
		git("commit", "-m", "merge");
		const head = git("rev-parse", "HEAD").trim();
		const result = spawnSync(
			process.execPath,
			[join(ROOT, "scripts", "secret-scan.mjs")],
			{
				cwd: root,
				encoding: "utf8",
				input: `refs/heads/main ${head} refs/heads/main ${base}\n`,
			},
		);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /merge-only\.txt/);
		assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

for (const fails of [false, true]) {
	test(`release forwards exact accessibility argv and scans the current bundle (bundle fails: ${fails})`, async () => {
		const { calls, state } = await releaseScript({
			failedGate: fails ? "desktop bundle" : undefined,
		});
		const accessibility = calls.find((args) => args.includes("@a11y"));
		assert.deepEqual(accessibility, [
			"pnpm.cjs",
			"--filter",
			"@mete/desktop",
			"test:e2e",
			"--grep",
			"@a11y",
		]);
		const desktop = JSON.parse(
			readFileSync(join(ROOT, "apps", "desktop", "package.json"), "utf8"),
		);
		assert.equal(desktop.scripts["test:e2e"], "playwright test");
		assert.deepEqual(
			["test", ...accessibility.slice(4)],
			["test", "--grep", "@a11y"],
		);
		const bundle = calls.findIndex((args) => args.includes("bundle"));
		const scan = calls.findIndex((args) => args.includes("electronegativity"));
		assert.ok(bundle >= 0);
		if (fails) {
			assert.equal(scan, -1);
			assert.equal(state.exitCode, 1);
		} else assert.ok(scan > bundle);
	});
}

for (const failedGate of [undefined, ...RELEASE_GATES]) {
	test(`release reports all 13 mandatory gates and fails closed (${failedGate ?? "all pass"})`, async () => {
		const { messages, state } = await releaseScript({ failedGate });
		const results = messages.filter((message) =>
			/^(pass|fail)\s/.test(message),
		);
		assert.deepEqual(
			results.map(
				(message) => message.replace(/^(pass|fail)\s+/, "").split(":")[0],
			),
			RELEASE_GATES,
		);
		assert.equal(state.exitCode, failedGate ? 1 : 0);
		if (failedGate)
			assert.ok(
				results.some((message) =>
					message.startsWith(`fail      ${failedGate}`),
				),
			);
	});
}

test("failed Windows packaging restores pnpm state and removes only its staging folder", async () => {
	const state = processState();
	let exited = false;
	state.exit = (code) => {
		exited = true;
		throw new Error(`process.exit(${code})`);
	};
	const restored = [];
	const removed = [];
	const before = Buffer.from('{"includeDevDependencies":true}');
	await assert.rejects(
		script(
			join(ROOT, "apps", "desktop", "scripts", "package-win.mjs"),
			{
				"node:child_process": {
					spawnSync: (_command, args) => ({
						status: args.includes("deploy") ? 0 : 7,
					}),
				},
				"node:fs": {
					existsSync: () => true,
					readFileSync: () => before,
					mkdtempSync: () => join(tmpdir(), "fake-mete-stage"),
					writeFileSync: (path, data) => {
						if (!exited) restored.push([path, data]);
					},
					cpSync() {},
					lstatSync: () => ({
						isDirectory: () => true,
						isSymbolicLink: () => false,
					}),
					rmSync: (path) => {
						if (!exited) removed.push(path);
					},
				},
			},
			state,
		),
	);
	const write = restored.find(([path]) =>
		path.endsWith(".pnpm-workspace-state-v1.json"),
	);
	assert.ok(write);
	assert.deepEqual(write[1], before);
	assert.deepEqual(removed, [join(tmpdir(), "fake-mete-stage")]);
});
