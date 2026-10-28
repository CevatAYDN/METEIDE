import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	type ChatChunk,
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonErrorDataSchema,
	type StorageSqlAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { runCommand } from "../src/application/commands.js";
import { daemonCommand } from "../src/application/daemon.js";
import { removeCommand } from "../src/application/remove.js";
import { type App, createApp, engineOf } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// Remove a run (ADR-143) through every real module: the run's checkpoint refs, its events and its
// model calls go with its row; the audit log stays.

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
			args: { path: "a.txt", oldStr: "a", newStr: "b" },
		},
		finish("tool-calls"),
	],
	[{ type: "text", text: "Done." }, finish("stop")],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const endedRun = async () => {
	const repo = await tempRepo({ "a.txt": "a\n" });
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
	expect(await runCommand(app.value, recordingIo().io, { goal: "edit" })).toBe(
		0,
	);
	const engine = engineOf(app.value);
	const runs = engine.ok ? engine.value.status() : undefined;
	const runId = runs?.ok ? runs.value[0]?.id : undefined;
	if (!runId) throw new Error("no run");
	return { app: app.value, repo, runId };
};

const count = (app: App, table: string, runId: string) => {
	const sql = app.registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) throw new Error("storage.sql@1 is not active");
	const column = table === "runs" ? "id" : "run_id";
	const row = sql.value[0].impl
		.scopeFor("cli-test")
		.workspace.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
		.get(runId) as { n: number };
	return row.n;
};

describe("mete remove (ADR-143)", () => {
	it("removes an ended run after a yes, with its refs, events and model calls, and keeps its audit rows", async () => {
		const { app, repo, runId } = await endedRun();
		const refs = () =>
			repo.git("for-each-ref", `refs/mete/checkpoints/${runId}`);
		expect(await refs()).not.toBe("");
		expect(count(app, "events", runId)).toBeGreaterThan(0);
		expect(count(app, "model_calls", runId)).toBeGreaterThan(0);
		const audited = count(app, "audit_log", runId);
		expect(audited).toBeGreaterThan(0);

		const t = recordingIo("", ["y"]);
		expect(await removeCommand(app, t.io, runId)).toBe(0);

		expect(t.prompts[0]).toContain(runId);
		expect(t.out).toEqual([`${runId} removed`]);
		expect(await refs()).toBe("");
		expect(count(app, "runs", runId)).toBe(0);
		expect(count(app, "events", runId)).toBe(0);
		expect(count(app, "model_calls", runId)).toBe(0);
		expect(count(app, "audit_log", runId)).toBe(audited);
	});

	it("removes nothing without a yes", async () => {
		const { app, runId } = await endedRun();
		for (const answers of [["n"], undefined]) {
			const t = recordingIo("", answers);
			expect(await removeCommand(app, t.io, runId)).toBe(1);
			expect(t.err).toEqual(["nothing removed"]);
		}
		expect(count(app, "runs", runId)).toBe(1);
	});
});

describe("mete daemon run.remove (ADR-143)", () => {
	it("removes an ended run and answers not_found for one it does not know", async () => {
		const { app, repo, runId } = await endedRun();
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		const serving = daemonCommand(app, recordingIo().io, repo.workspaceDir, {
			input: toDaemon,
			output: toClient,
		});
		const c = createMessageConnection(
			new StreamMessageReader(toClient),
			new StreamMessageWriter(toDaemon),
		);
		const removed = new Promise<string | undefined>((resolve) =>
			c.onNotification(
				DAEMON_METHODS.event,
				(e: { type: string; runId?: string }) => {
					if (e.type === "run.removed") resolve(e.runId);
				},
			),
		);
		c.listen();
		try {
			expect(
				await c.sendRequest(DAEMON_METHODS.runRemove, { runId }),
			).toBeNull();
			expect(await removed).toBe(runId);
			const unknown = await c
				.sendRequest(DAEMON_METHODS.runRemove, { runId })
				.catch((e: unknown) => e);
			expect(unknown).toBeInstanceOf(ResponseError);
			if (unknown instanceof ResponseError) {
				expect(unknown.code).toBe(DAEMON_ERROR_CODE);
				expect(DaemonErrorDataSchema.parse(unknown.data).code).toBe(
					"not_found",
				);
			}
		} finally {
			c.dispose();
			toDaemon.end();
			await serving;
		}
	});
});
