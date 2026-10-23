import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A script that speaks protocol version 1 like `mete daemon`, run by a real Node child, so the host
// is tested over real pipes without Electron or @mete/cli. The mode (argv 3) picks its behaviour.

const jsonrpc = createRequire(__filename).resolve("vscode-jsonrpc/node");

const SCRIPT = `
const { createMessageConnection, StreamMessageReader, StreamMessageWriter, ResponseError } = require(${JSON.stringify(jsonrpc)});
const [, , dir, mode] = process.argv;
if (mode === "exit") {
	process.stderr.write("no provider key for " + dir + "\\n");
	process.exit(1);
}
const run = { id: "6f1c3d52-9b7e-4a52-8d5f-0a1b2c3d4e5f", workspaceId: "0b6f0a43-3f0e-4a3e-9a58-1b2c3d4e5f60", templateId: null, goal: "fix it", status: "paused", pauseReason: "quota", autonomyLevel: 2, budget: { cloudRequests: 10, maxHours: 1 }, createdAt: "2026-10-23T10:00:00.000Z" };
const conn = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
conn.onRequest("mete/status", (p) => {
	if (mode === "notready") throw new ResponseError(-32000, "core-engine is not active", { code: "not_ready", reasons: ["core-engine is not active.", "Add a provider key with: mete key set openrouter"] });
	if (p && p.runId === "baddata") throw new ResponseError(-32000, "odd", { oops: 1 });
	if (p && p.runId === "die") process.exit(1);
	if (p && p.runId === "refuse") throw new ResponseError(-32000, "run not found", { code: "not_found" });
	if (p && p.runId === "garbage") return [{ nope: 1 }];
	return mode === "one" ? [run] : [];
});
conn.onClose(() => process.exit(0));
conn.listen();
`;

/** Writes the script and returns a spawn that counts its starts; `mode` may change between calls. */
export const fakeDaemon = async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-fake-daemon-"));
	const script = join(root, "daemon.cjs");
	await writeFile(script, SCRIPT);
	const state = { mode: "ok", starts: [] as string[] };
	return {
		state,
		spawn: (dir: string) => {
			state.starts.push(dir);
			return spawn(process.execPath, [script, dir, state.mode]);
		},
		close: () => rm(root, { recursive: true, force: true }),
	};
};
