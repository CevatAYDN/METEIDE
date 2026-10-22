// MCP conformance of `mete mcp` through the MCP Inspector CLI, release tier (docs/15).
// Run with `pnpm check:mcp`; it downloads the Inspector, so it is not part of `pnpm check`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
		{ encoding: "utf8" },
	);
	try {
		return { code: r.status, json: JSON.parse(r.stdout) };
	} catch {
		return fail(`${args.join(" ")} printed no JSON\n${r.stderr}`);
	}
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

const ws = mkdtempSync(join(tmpdir(), "mete-mcp-"));
try {
	if (!existsSync(BIN)) fail("build first: pnpm build");
	check(ws);
} catch (e) {
	console.error(`mcp conformance failed: ${e.message}`);
	process.exitCode = 1;
} finally {
	rmSync(ws, { recursive: true, force: true });
}
