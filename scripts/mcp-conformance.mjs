// MCP conformance of `mete mcp` through the MCP Inspector CLI, release tier (docs/15).
// Run with `pnpm check:mcp`; it downloads the Inspector, so it is not part of `pnpm check`.
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 2.10.1 is the newest release older than the 14 days docs/05 asks for (2026-10-08).
const INSPECTOR = "@modelcontextprotocol/inspector@2.10.1";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "apps", "cli", "dist", "bin.js");
const TOOLS = [
	"mete_run_team",
	"mete_task_status",
	"mete_approve",
	"mete_knowledge_search",
];

const fail = (why) => {
	throw new Error(why);
};

/** One Inspector call; the target must come before the options. */
const inspect = (ws, args) => {
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: a root script pnpm runs, not a turbo task
	const pnpm = process.env.npm_execpath;
	if (!pnpm) fail("run it through pnpm check:mcp");
	const r = spawnSync(
		process.execPath,
		[pnpm, "--silent", `--package=${INSPECTOR}`, "dlx", "mcp-inspector"].concat(
			["--cli", process.execPath, BIN, "mcp", ws, ...args],
		),
		// The first run downloads the Inspector; a hung server must not hang the check.
		{ encoding: "utf8", timeout: 300_000 },
	);
	let json;
	try {
		json = JSON.parse(r.stdout);
	} catch {
		fail(`${args.join(" ")} printed no JSON\n${r.stderr}`);
	}
	// The Inspector's own error, such as the server exiting because core-engine is not active.
	if (json.error) fail(`${json.error.message}\n${r.stderr}`);
	return { code: r.status, json };
};

const expect = (ok, why) => {
	if (!ok) fail(why);
	console.log(`ok  ${why}`);
};

// Every call is refused on purpose: none may start a real run.
const REFUSED = [
	["mete_task_status", ["runId=nope"], "not_found"],
	["mete_approve", ["runId=nope", "decision=approve"], "not_found"],
	["mete_knowledge_search", ["query=x"], "Phase 4"],
	["mete_run_team", ["goal=x", "templateId=no-such-template"], "no template"],
];

const check = (ws) => {
	const init = inspect(ws, ["--method", "initialize"]);
	expect(
		init.code === 0 && init.json.serverInfo?.name === "mete",
		"initialize names the server mete",
	);
	const list = inspect(ws, ["--method", "tools/list", "--strict"]);
	const tools = list.json.tools ?? [];
	expect(list.code === 0, "tools/list --strict finds no schema problem");
	expect(tools.map((t) => t.name).join() === TOOLS.join(), "the four tools");
	for (const [name, args, text] of REFUSED) {
		const r = inspect(
			ws,
			["--method", "tools/call", "--tool-name", name].concat([
				"--tool-arg",
				...args,
			]),
		);
		expect(
			r.json.isError === true && JSON.stringify(r.json.content).includes(text),
			`${name} answers a refusal with "${text}"`,
		);
	}
	expect(
		!existsSync(join(ws, ".mete", "cache", "run.lock")),
		"run.lock is released",
	);
};

// METE as a client against reference servers (docs/15): a Node one over stdio, a Python one over
// stdio, and the Node one again over streamable HTTP. Versions are exact and at least 14 days old
// (docs/05); `npx` and `uvx` do not go through pnpm's minimumReleaseAge, so the pins are manual.
const EVERYTHING = "@modelcontextprotocol/server-everything";
const EVERYTHING_VERSION = "2026.8.31"; // released 2026-08-31
const TIME = "mcp-server-time==2026.8.18"; // released 2026-08-18
// The tool each server is asked for, and what its answer must contain.
const CLIENT_CALLS = [
	["ref-node", "echo", { message: "hi" }, "hi"],
	["ref-python", "get_current_time", { timezone: "UTC" }, "UTC"],
	["ref-http", "echo", { message: "hi" }, "hi"],
];

const freePort = () =>
	new Promise((done) => {
		const s = createServer().listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => done(port));
		});
	});

/** Installs the Node reference server into dir, and starts its streamable HTTP mode on port. */
const startHttpServer = async (dir, port) => {
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: a root script pnpm runs, not a turbo task
	const pnpm = process.env.npm_execpath;
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "package.json"), "{}");
	const add = spawnSync(
		process.execPath,
		[
			pnpm,
			"add",
			"--ignore-workspace",
			"--dir",
			dir,
			`${EVERYTHING}@${EVERYTHING_VERSION}`,
		],
		{ encoding: "utf8", timeout: 300_000 },
	);
	if (add.status !== 0) fail(`installing ${EVERYTHING}: ${add.stderr}`);
	const entry = join(dir, "node_modules", EVERYTHING, "dist", "index.js");
	const child = spawn(process.execPath, [entry, "streamableHttp"], {
		env: { ...process.env, PORT: String(port) },
		stdio: "ignore",
	});
	// Ready when the endpoint answers anything at all.
	for (let i = 0; i < 60; i++) {
		try {
			await fetch(`http://127.0.0.1:${port}/mcp`);
			return child;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	child.kill();
	return fail("the HTTP reference server did not start");
};

const mcpYaml = (port) => `servers:
  - id: ref-node
    transport: stdio
    runtime: node
    command: npx
    args: ["-y", "${EVERYTHING}@${EVERYTHING_VERSION}"]
    permissions: []
  - id: ref-python
    transport: stdio
    runtime: python
    command: uvx
    args: ["${TIME}"]
    permissions: []
  - id: ref-http
    transport: streamable-http
    url: http://127.0.0.1:${port}/mcp
    permissions: []
`;

/** The app of the CLI over a workspace that names the reference servers; raw calls are allowed at autonomy 3. */
const clientApp = async (work, port) => {
	const workspaceDir = join(work, "workspace");
	mkdirSync(join(workspaceDir, ".mete"), { recursive: true });
	writeFileSync(join(workspaceDir, ".mete", "mcp.yaml"), mcpYaml(port));
	writeFileSync(join(workspaceDir, ".mete", "policy.yaml"), "autonomy: 3\n");
	const warnings = [];
	const note = (o, m) => warnings.push(`${m} ${JSON.stringify(o)}`);
	const logger = { error: note, warn: note, info() {}, debug() {} };
	const url = pathToFileURL(join(ROOT, "apps/cli/dist/infrastructure/app.js"));
	const { createApp } = await import(url.href);
	const secrets = {
		get: async () => ({ ok: true, value: undefined }),
		set: async () => ({ ok: true, value: undefined }),
		delete: async () => ({ ok: true, value: false }),
	};
	const app = await createApp({
		workspaceDir,
		globalDir: join(work, "global"),
		logger,
		secrets,
		providers: [],
	});
	if (!app.ok) fail(JSON.stringify(app.error));
	return { app: app.value, warnings };
};

const checkClient = async (work) => {
	const port = await freePort();
	const http = await startHttpServer(join(work, "everything"), port);
	const { app, warnings } = await clientApp(work, port);
	try {
		const found = app.registry.resolve("mcp.tools@1");
		if (!found.ok) fail("mcp.tools@1 is not active");
		const mcp = found.value[0].impl;
		const signal = AbortSignal.timeout(300_000);
		const listed = await mcp.list(signal);
		if (!listed.ok) fail(listed.error.message);
		for (const [server, tool, args, text] of CLIENT_CALLS) {
			const has = listed.value.some(
				(t) => t.server === server && t.name === tool,
			);
			expect(has, `${server} lists ${tool}${has ? "" : ` (${warnings})`}`);
			const r = await mcp.call({ server, tool, args }, { signal });
			const said = r.ok ? JSON.stringify(r.value.content) : r.error.message;
			expect(
				r.ok && said.includes(text),
				`${server} answers ${tool}: ${said.slice(0, 120)}`,
			);
		}
	} finally {
		await app.stop();
		http.kill();
	}
};

const ws = mkdtempSync(join(tmpdir(), "mete-mcp-"));
const clientWork = mkdtempSync(join(tmpdir(), "mete-mcp-client-"));
try {
	if (!existsSync(BIN)) fail("build first: pnpm build");
	check(ws);
	await checkClient(clientWork);
} catch (e) {
	console.error(`mcp conformance failed: ${e.message}`);
	process.exitCode = 1;
} finally {
	rmSync(ws, { recursive: true, force: true });
	rmSync(clientWork, { recursive: true, force: true });
}
