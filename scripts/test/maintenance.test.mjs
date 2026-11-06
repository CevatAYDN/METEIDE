import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Execute the real maintenance entrypoints with filesystem/process effects replaced, not their logic.
const script = async (path, overrides, processState) => {
	const context = createContext({
		process: processState,
		console: { log() {}, error() {} },
	});
	const module = new SourceTextModule(readFileSync(path, "utf8"), {
		context,
		initializeImportMeta: (meta) => {
			meta.url = pathToFileURL(path).href;
		},
	});
	await module.link(async (name) => {
		const exports = { ...(await import(name)), ...overrides[name] };
		return new SyntheticModule(
			Object.keys(exports),
			function () {
				for (const [key, value] of Object.entries(exports))
					this.setExport(key, value);
			},
			{ context },
		);
	});
	return module.evaluate();
};

const processState = () => ({
	execPath: process.execPath,
	platform: process.platform,
	env: { npm_execpath: "pnpm.cjs" },
	exitCode: undefined,
	exit: (code) => {
		throw new Error(`process.exit(${code})`);
	},
});

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
	test(`release scan uses the current bundle and fails closed (bundle fails: ${fails})`, async () => {
		const calls = [];
		const state = processState();
		await script(
			join(ROOT, "scripts", "release-check.mjs"),
			{
				"node:child_process": {
					spawnSync: (_command, args) => {
						calls.push(args.join(" "));
						const bundle = args.includes("bundle");
						return {
							status: fails && bundle ? 1 : 0,
							stdout: args.includes("licenses") ? "{}" : "",
							stderr: "",
						};
					},
				},
				"node:fs": {
					readFileSync: (path) =>
						String(path).endsWith("package.json")
							? '{"devDependencies":{"electron":"42.11.14"}}'
							: "id,severity\n",
					mkdtempSync: () => join(tmpdir(), "fake-electronegativity"),
					rmSync() {},
					readdirSync: () => ["installer.exe"],
				},
			},
			state,
		);
		const bundle = calls.findIndex((call) =>
			call.includes("@mete/desktop bundle"),
		);
		const scan = calls.findIndex((call) =>
			call.includes("dlx electronegativity"),
		);
		assert.ok(bundle >= 0);
		if (fails) {
			assert.equal(scan, -1);
			assert.equal(state.exitCode, 1);
		} else assert.ok(scan > bundle);
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
