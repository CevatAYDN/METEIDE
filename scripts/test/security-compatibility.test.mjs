import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire, Module } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	createContext,
	Script,
	SourceTextModule,
	SyntheticModule,
} from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const kernel = createRequire(join(root, "packages/kernel/package.json"));
const { z } = kernel("zod");
const manifestSchema = z.object({
	name: z.string(),
	version: z.string(),
	main: z.string().optional(),
	exports: z.unknown().optional(),
	module: z.string().optional(),
});
const manifest = (file) =>
	manifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
const desktop = createRequire(join(root, "apps/desktop/package.json"));
const fromTheia = (extension, name) => {
	const req = createRequire(
		desktop.resolve(`@theia/${extension}/package.json`),
	);
	return req.resolve(`${name}/package.json`);
};
const parents = {
	proxy: fromTheia("plugin-ext", "@vscode/proxy-agent"),
	mocha: fromTheia("cli", "mocha"),
	tooltip: fromTheia("core", "react-tooltip"),
	trash: fromTheia("filesystem", "trash"),
};
parents.http = createRequire(parents.proxy).resolve(
	"http-proxy-agent/package.json",
);
const options = z
	.object({
		"candidate-root": z.string().min(1).optional(),
		"diff-candidate": z.boolean().optional(),
	})
	.parse(
		parseArgs({
			options: {
				"candidate-root": { type: "string" },
				"diff-candidate": { type: "boolean" },
			},
		}).values,
	);
const candidateRoot = options["candidate-root"];
const diffCandidate = options["diff-candidate"];
const targets = { "@tootallnate/once": "2.0.1", diff: "8.0.3", uuid: "11.1.1" };

test("security selections are exact-old-version scoped and preserve R1 and age policy", () => {
	const cfg = z
		.object({
			minimumReleaseAge: z.literal(20160),
			overrides: z.record(z.string(), z.string()),
		})
		.parse(
			kernel("yaml").parse(
				readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
			),
		);
	for (const [selector, version] of Object.entries({
		"@tootallnate/once@1.1.2": "2.0.1",
		"uuid@7.0.3": "11.1.1",
		"uuid@8.3.2": "11.1.1",
		electron: "42.11.16",
		"body-parser@>=1.20.0 <1.20.9": "1.20.9",
		"body-parser@>=2.0.0 <2.4.0": "2.4.0",
		"multer@>=2.0.0 <2.5.0": "2.5.0",
		"fast-uri@>=3.0.0 <3.1.9": "3.1.9",
		"serialize-javascript": "7.1.3",
	}))
		assert.equal(cfg.overrides[selector], version, selector);
	assert.equal(Object.hasOwn(cfg.overrides, "uuid"), false);
	assert.equal(Object.hasOwn(cfg.overrides, "@tootallnate/once"), false);
	assert.ok(
		Object.keys(cfg.overrides).every(
			(key) => key !== "diff" && !key.startsWith("diff@"),
		),
	);
});

function packageFile(parent, name) {
	if (!candidateRoot || (name === "diff" && !diffCandidate))
		return createRequire(parent).resolve(`${name}/package.json`);
	const folder = name === "@tootallnate/once" ? "once" : name;
	const dir = join(realpathSync(candidateRoot), folder, "package");
	assert.equal(manifest(join(dir, "package.json")).name, name);
	assert.equal(manifest(join(dir, "package.json")).version, targets[name]);
	return join(dir, "package.json");
}

function dependency(parent, name) {
	const file = packageFile(parent, name);
	const dir = dirname(file);
	return createRequire(join(dir, "package.json"))(dir);
}

// Evaluate unchanged published parent bytes, replacing only dependency/OS boundaries.
function consumer(parent, entry, replacements) {
	const base = dirname(parent);
	const cache = new Map();
	function load(file) {
		if (cache.has(file)) return cache.get(file).exports;
		const module = { exports: {} };
		cache.set(file, module);
		const req = createRequire(file);
		const require = (name) => {
			if (Object.hasOwn(replacements, name)) return replacements[name];
			const target = req.resolve(name);
			if (name.startsWith(".") && target.startsWith(`${base}${sep}`))
				return load(target);
			return req(name);
		};
		new Script(Module.wrap(readFileSync(file, "utf8")), {
			filename: file,
		}).runInThisContext()(module.exports, require, module, file, dirname(file));
		return module.exports;
	}
	return load(join(base, entry));
}

test("parents resolve approved fixes; diff stays blocked (candidate bytes are not an install)", () => {
	const versions = [];
	for (const [parent, name] of [
		[parents.proxy, "@tootallnate/once"],
		[parents.http, "@tootallnate/once"],
		[parents.mocha, "diff"],
		[parents.tooltip, "uuid"],
		[parents.trash, "uuid"],
	]) {
		versions.push(manifest(packageFile(parent, name)).version);
	}
	assert.deepEqual(versions, [
		"2.0.1",
		"2.0.1",
		diffCandidate && candidateRoot ? "8.0.3" : "7.0.0",
		"11.1.1",
		"11.1.1",
	]);
});

test("once keeps proxy-consumed default import, connect and error cleanup", async () => {
	for (const parent of [parents.proxy, parents.http]) {
		const imported = dependency(parent, "@tootallnate/once");
		const once = imported.__esModule ? imported.default : imported;
		assert.equal(typeof once, "function");
		const socket = new EventEmitter();
		const pending = once(socket, "connect");
		socket.emit("connect", "ignored by both parents");
		await pending;
		assert.equal(socket.listenerCount("connect"), 0);
		assert.equal(socket.listenerCount("error"), 0);
		const error = new Error("connection refused");
		const rejected = once(socket, "connect");
		const check = assert.rejects(rejected, (actual) => actual === error);
		socket.emit("error", error);
		await check;
		assert.equal(socket.listenerCount("connect"), 0);
		assert.equal(socket.listenerCount("error"), 0);
	}
});

test("HTTP and PAC public agents preserve socket success, rejection and fallback", async () => {
	for (const fail of [false, true]) {
		const socket = new EventEmitter();
		const error = new Error("fixture connection refused");
		const connect = () => {
			queueMicrotask(() => socket.emit(fail ? "error" : "connect", error));
			return socket;
		};
		const httpAgent = consumer(parents.http, "dist/index.js", {
			"@tootallnate/once": dependency(parents.http, "@tootallnate/once"),
			net: { connect },
			tls: { connect },
		});
		const req = new EventEmitter();
		req.path = "/file?q=1";
		req.setHeader = (name, value) =>
			assert.deepEqual([name, value], ["Proxy-Authorization", "Basic dTpw"]);
		const opts = { host: "fixture.invalid", port: 80 };
		const agent = httpAgent("http://u:p@proxy.invalid:8080");
		const pending = agent.callback(req, opts);
		if (fail) await assert.rejects(pending, (actual) => actual === error);
		else assert.equal(await pending, socket);
		assert.equal(req.path, "http://fixture.invalid/file?q=1");
		const pac = consumer(parents.proxy, "out/agent.js", {
			"@tootallnate/once": dependency(parents.proxy, "@tootallnate/once"),
			"http-proxy-agent": httpAgent,
		});
		const direct = createRequire(parents.proxy)("http").globalAgent;
		const result = await pac(() => "PROXY proxy.invalid:8080; DIRECT").callback(
			req,
			opts,
		);
		assert.equal(result, fail ? direct : socket);
		assert.equal(socket.listenerCount("connect"), 0);
		assert.equal(socket.listenerCount("error"), 0);
	}
});

const corpus = [
	["", ""],
	["old", "new"],
	["same\nold\n", "same\nnew\n"],
	["a\r\nb\r\n", "a\r\nc\r\n"],
	["a  b\tend", "a b end"],
	["a\n\nb", "a\nb"],
	["\u0130stanbul \u00d7 x", "\u0130stanbul \u00f7 x"],
	["a\u00adb\n", "ab\n"],
	["a\u2028b", "a\u2029b"],
	["x\nx\nx\n", "x\ny\nx"],
	["file\u0000a", "file\u0000b"],
];
const digest = (value) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("Mocha public generateDiff preserves unified and inline consumer output", () => {
	const diff = dependency(parents.mocha, "diff");
	const base = consumer(parents.mocha, "lib/reporters/base.js", { diff });
	base.useColors = false;
	const rendered = [];
	for (const inline of [false, true]) {
		base.inlineDiffs = inline;
		for (const [actual, expected] of corpus)
			rendered.push(base.generateDiff(actual, expected));
	}
	// Golden from unchanged Mocha 11.8.0 + installed diff 7.0.0, not candidate output.
	assert.equal(
		digest(rendered),
		"ea6b073b965dca946147fc447e1a20d0410cae010347da8edf30866fb9691d9d",
	);
	assert.ok(
		rendered.every((text) => !text.includes("failed to generate Mocha diff")),
	);
	assert.equal(
		diff.createPatch("string", "old", "new").split("\n")[4],
		"@@ -1,1 +1,1 @@",
	);
	assert.deepEqual(
		diff
			.diffWordsWithSpace("old", "new")
			.map(({ value, added, removed }) => ({ value, added, removed })),
		[
			{ value: "old", added: false, removed: true },
			{ value: "new", added: true, removed: false },
		],
	);
});

test("Mocha inline soft-hyphen insertion must not delete the unchanged prefix", () => {
	const diff = dependency(parents.mocha, "diff");
	const base = consumer(parents.mocha, "lib/reporters/base.js", { diff });
	base.useColors = false;
	base.inlineDiffs = true;
	assert.equal(
		base.generateDiff("a", "a\u00adb"),
		"      \n      actual expected\n      \n      a\u00adb\n      ",
	);
	assert.deepEqual(
		diff
			.diffWordsWithSpace("a", "a\u00adb")
			.map(({ value, added, removed }) => ({ value, added, removed })),
		[
			{ value: "a", added: false, removed: false },
			{ value: "\u00adb", added: true, removed: false },
		],
	);
});

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
test("uuid v4 preserves node named exports, randomness and buffer output", () => {
	for (const parent of [parents.tooltip, parents.trash]) {
		const uuid = dependency(parent, "uuid");
		assert.equal(typeof uuid.v4, "function");
		assert.match(uuid.v4(), uuidPattern);
		assert.equal(new Set(Array.from({ length: 64 }, () => uuid.v4())).size, 64);
		const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
		assert.equal(
			uuid.v4({ random: bytes }),
			"00010203-0405-4607-8809-0a0b0c0d0e0f",
		);
		const buffer = new Uint8Array(20).fill(255);
		assert.equal(
			uuid.v4(
				{ random: Uint8Array.from({ length: 16 }, (_, i) => i) },
				buffer,
				2,
			),
			buffer,
		);
		assert.deepEqual(
			[...buffer],
			[
				255, 255, 0, 1, 2, 3, 4, 5, 70, 7, 136, 9, 10, 11, 12, 13, 14, 15, 255,
				255,
			],
		);
	}
});

async function esmConsumer(file, replacements = {}) {
	const context = createContext({ crypto: globalThis.crypto, Uint8Array });
	const cache = new Map();
	const load = (entry) => {
		if (cache.has(entry)) return cache.get(entry);
		const module = new SourceTextModule(readFileSync(entry, "utf8"), {
			context,
			identifier: entry,
		});
		cache.set(entry, module);
		return module;
	};
	const entry = load(file);
	await entry.link((name, referencing) => {
		if (name.startsWith("."))
			return load(resolve(dirname(referencing.identifier), name));
		const value = replacements[name] ?? createRequire(file)(name);
		const names = [...new Set(["default", ...Object.keys(value)])];
		return new SyntheticModule(
			names,
			function () {
				for (const key of names)
					this.setExport(key, key === "default" ? value : value[key]);
			},
			{ context },
		);
	});
	await entry.evaluate();
	return entry.namespace;
}

test("react-tooltip ESM consumer links real uuid browser exports and renders identity", async () => {
	const uuidFile = packageFile(parents.tooltip, "uuid");
	const pkg = z
		.object({
			module: z.string(),
			browser: z.record(z.string(), z.string()),
			exports: z
				.object({
					".": z
						.object({ browser: z.object({ import: z.string() }).optional() })
						.passthrough(),
				})
				.passthrough()
				.optional(),
		})
		.parse(JSON.parse(readFileSync(uuidFile, "utf8")));
	const browserEntry =
		pkg.exports?.["."]?.browser?.import ??
		pkg.browser[pkg.module.startsWith(".") ? pkg.module : `./${pkg.module}`];
	assert.equal(typeof browserEntry, "string");
	const uuid = await esmConsumer(join(dirname(uuidFile), browserEntry));
	assert.equal(
		uuid.v4({ random: Uint8Array.from({ length: 16 }, (_, i) => i) }),
		"00010203-0405-4607-8809-0a0b0c0d0e0f",
	);
	assert.match(uuid.v4(), uuidPattern);
	const Tooltip = await esmConsumer(
		join(dirname(parents.tooltip), manifest(parents.tooltip).module),
		{ uuid },
	);
	const req = createRequire(parents.tooltip);
	const html = req("react-dom/server").renderToStaticMarkup(
		req("react").createElement(Tooltip.default, { children: "fixture" }),
	);
	assert.match(html.match(/id="t([0-9a-f-]+)"/)?.[1], uuidPattern);
});

test("react-tooltip public rendering preserves generated UUID identity", () => {
	const Tooltip = consumer(parents.tooltip, "dist/index.js", {
		uuid: dependency(parents.tooltip, "uuid"),
	});
	const req = createRequire(parents.tooltip);
	const React = req("react");
	const render = req("react-dom/server").renderToStaticMarkup;
	const html = render(React.createElement(Tooltip, { children: "fixture" }));
	const id = html.match(/id="t([0-9a-f-]+)"/)?.[1];
	assert.match(id, uuidPattern);
	assert.ok(html.includes(`__react_component_tooltip t${id}`));
	assert.ok(html.includes(`.t${id}`));
});

test("trash Linux public function preserves file and trashinfo UUID filenames", async () => {
	const fixture = mkdtempSync(join(tmpdir(), "mete-r3-trash-"));
	try {
		const file = join(fixture, "input file.txt");
		writeFileSync(file, "preserved contents");
		const trash = consumer(parents.trash, "lib/linux.js", {
			uuid: dependency(parents.trash, "uuid"),
			"xdg-trashdir": async (mount) => {
				assert.equal(mount, fixture);
				return fixture;
			},
			"@stroncium/procfs": {
				procfs: {
					processMountinfo: () => [
						{ devId: statSync(file).dev, mountPoint: fixture },
					],
				},
			},
		});
		const [result] = await trash([file]);
		const name = relative(join(fixture, "files"), result.path);
		assert.match(name, uuidPattern);
		assert.equal(result.info, join(fixture, "info", `${name}.trashinfo`));
		assert.equal(readFileSync(result.path, "utf8"), "preserved contents");
		assert.ok(
			readFileSync(result.info, "utf8").startsWith(
				`[Trash Info]\nPath=${file.replace(/\s/g, "%20")}\nDeletionDate=`,
			),
		);
		assert.equal(existsSync(file), false);
	} finally {
		const owned = realpathSync(fixture);
		const inside = relative(realpathSync(tmpdir()), owned);
		assert.ok(inside && !inside.startsWith("..") && !isAbsolute(inside));
		rmSync(owned, { recursive: true, force: true });
	}
});
