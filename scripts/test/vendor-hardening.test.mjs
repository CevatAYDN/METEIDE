import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The local hardening patches for advisories without a fixed release
// (patches/decompress@4.2.1.patch, patches/deepmerge@4.3.1.patch).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const theia = createRequire(
	createRequire(join(root, "apps/desktop/package.json")).resolve(
		"@theia/plugin-ext/package.json",
	),
);
const decompress = theia("decompress");
const deepmerge = createRequire(
	theia.resolve("decompress").replace(/decompress[\\/]index\.js$/, "x"),
)("deepmerge");
const mocha = createRequire(
	createRequire(
		createRequire(join(root, "apps/desktop/package.json")).resolve(
			"@theia/cli/package.json",
		),
	).resolve("mocha/package.json"),
);
const theiaFs = createRequire(theia.resolve("@theia/filesystem/package.json"));
const glob = mocha("glob");
const minimatchOf = (req) => req("minimatch").minimatch;

const entry = (path, extra = {}) => ({
	path,
	type: "file",
	mode: 0o644,
	mtime: new Date(0),
	data: Buffer.from(path),
	...extra,
});
const extract = (dir, files) =>
	decompress(Buffer.from("x"), dir, { plugins: [async () => files] });

const withDir = async (fn) => {
	const base = mkdtempSync(join(tmpdir(), "mete-decompress-"));
	try {
		await fn(base);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
};

test("decompress refuses hardlink and symlink entries (GHSA-jwp9-9v96-94mx, GHSA-hrh2-vp3x-79xf)", () =>
	withDir(async (base) => {
		const out = join(base, "out");
		for (const type of ["link", "symlink"])
			await assert.rejects(
				extract(out, [entry("evil", { type, linkname: join(base, "x") })]),
				/link entry/,
			);
		assert.equal(existsSync(join(out, "evil")), false);
	}));

test("decompress keeps a sibling with the output's name prefix outside (GHSA-mp2f-45pm-3cg9)", () =>
	withDir(async (base) => {
		const out = join(base, "out");
		mkdirSync(join(base, "out-old"));
		await assert.rejects(extract(out, [entry("../out-old/pwn")]));
		assert.equal(existsSync(join(base, "out-old", "pwn")), false);
	}));

test("decompress still extracts ordinary files and drops special mode bits", () =>
	withDir(async (base) => {
		const out = join(base, "out");
		await extract(out, [entry("a/b.txt", { mode: 0o4755 }), entry("c.txt")]);
		assert.equal(readFileSync(join(out, "a/b.txt"), "utf8"), "a/b.txt");
		assert.equal(statSync(join(out, "a/b.txt")).mode & 0o7000, 0);
	}));

test("deepmerge refuses prototype-shaping keys (GHSA-gcqx-w48m-w2h4)", () => {
	const merged = deepmerge(
		{ constructor: { x: 1 }, a: { b: 1 } },
		JSON.parse('{"constructor":{"prototype":{"polluted":2}},"a":{"c":2}}'),
	);
	assert.equal(merged.constructor?.prototype?.polluted, undefined);
	assert.deepEqual(merged.a, { b: 1, c: 2 });
});

test("diff parses headers with Unicode line separators without hanging (GHSA-73rr-hh4g-fpgx)", () => {
	const script = `const { parsePatch } = require(${JSON.stringify(mocha.resolve("diff"))});
parsePatch("--- a\\u2028b\\n+++ c\\n@@ -1 +1 @@\\n-x\\n+y\\n");`;
	const r = spawnSync(process.execPath, ["-e", script], { timeout: 10_000 });
	assert.equal(r.status, 0, "parsePatch did not finish");
	const patch = mocha("diff").createPatch("a.txt", "x\n", "y\n", "h1", "h2");
	assert.equal(mocha("diff").applyPatch("x\n", patch), "y\n");
});

test("minimatch bounds **/.. pattern amplification (GHSA-g3hv-75wg-m249)", () => {
	const pattern = `${"**/../a/b/".repeat(20)}c`;
	for (const minimatch of [minimatchOf(theiaFs), minimatchOf(mocha)]) {
		const started = Date.now();
		minimatch("a/b/c", pattern, { optimizationLevel: 2 });
		assert.ok(Date.now() - started < 5_000);
		assert.equal(minimatch("src/a.ts", "src/**/*.ts"), true);
	}
});

test("glob stops walking after an abort (GHSA-3g3m-2fjr-6pw4)", async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		glob.glob("**/*", { cwd: root, signal: controller.signal }),
	);
	assert.ok((await glob.glob("scripts/test/*.mjs", { cwd: root })).length > 0);
});
