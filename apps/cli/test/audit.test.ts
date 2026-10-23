import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	type ChatChunk,
	DAEMON_METHODS,
	DaemonAuditResultSchema,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { auditCommand } from "../src/application/audit.js";
import { runCommand } from "../src/application/commands.js";
import { daemonCommand } from "../src/application/daemon.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// The audit log of a real run (SECURITY.md, Audit log; ADR-053): the typo fix's edit leaves a row,
// which `mete audit` and the daemon's mete/audit show, filtered.

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const EDIT: ChatChunk[][] = [
	[
		{
			type: "tool-call",
			id: "c1",
			name: "fs_edit",
			args: { path: "greet.js", oldStr: "Helo", newStr: "Hello" },
		},
		finish("tool-calls"),
	],
	[{ type: "text", text: "Fixed." }, finish("stop")],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const ranFixture = async () => {
	const repo = await tempRepo({
		"greet.js": 'export const greet = (n) => "Helo " + n;\n',
	});
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		templatesDir: join(repo.globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script: EDIT })],
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	close = async () => {
		await app.value.stop();
		await repo.close();
	};
	expect(
		await runCommand(app.value, recordingIo().io, { goal: "fix the typo" }),
	).toBe(0);
	return { app: app.value, repo };
};

describe("the audit log", () => {
	it("prints the edit's row in mete audit, and as JSON with --json", async () => {
		const { app } = await ranFixture();
		const t = recordingIo();
		expect(auditCommand(app, t.io, undefined, false)).toBe(0);
		expect(t.out.join("\n")).toContain("fs.write fs.edit@1  allow");
		const j = recordingIo();
		expect(auditCommand(app, j.io, undefined, true)).toBe(0);
		const rows = JSON.parse(j.out.join("\n"));
		expect(rows[0]).toMatchObject({
			action: "fs.write",
			capability: "fs.edit@1",
		});
	});

	it("answers mete/audit with the rows that match its filters", async () => {
		const { app, repo } = await ranFixture();
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		const serving = daemonCommand(app, recordingIo().io, repo.workspaceDir, {
			input: toDaemon,
			output: toClient,
		});
		const c = createMessageConnection(
			new StreamMessageReader(toClient),
			new StreamMessageWriter(toDaemon),
		);
		c.listen();
		const audit = async (params: object) =>
			DaemonAuditResultSchema.parse(
				await c.sendRequest(DAEMON_METHODS.audit, params),
			).entries;
		const all = await audit({});
		expect(all.map((e) => e.action)).toContain("fs.write");
		const runId = all[0]?.runId ?? "";
		expect((await audit({ runId, action: "fs.write" })).length).toBeGreaterThan(
			0,
		);
		expect(await audit({ verdict: "deny" })).toEqual([]);
		expect(await audit({ runId: crypto.randomUUID() })).toEqual([]);
		expect(await audit({ limit: 1 })).toHaveLength(1);
		toDaemon.end();
		expect(await serving).toBe(0);
		c.dispose();
	});
});
