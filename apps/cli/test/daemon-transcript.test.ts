import { PassThrough } from "node:stream";
import {
	type ChatChunk,
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonErrorDataSchema,
	DaemonRunStartResultSchema,
	TranscriptSchema,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// mete/run.transcript over the daemon protocol (ADR-125).

const usage = { prompt: 1, completion: 1 };
const READ: ChatChunk[] = [
	{ type: "tool-call", id: "c1", name: "fs_read", args: { path: "a.txt" } },
	{ type: "finish", reason: "tool-calls", usage },
];
const DONE: ChatChunk[] = [
	{ type: "text", text: "done" },
	{ type: "finish", reason: "stop", usage },
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const serve = async () => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script: [READ, DONE] })],
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
	const serving = daemonCommand(
		app.value,
		recordingIo().io,
		repo.workspaceDir,
		{
			input: toDaemon,
			output: toClient,
		},
	);
	const c = createMessageConnection(
		new StreamMessageReader(toClient),
		new StreamMessageWriter(toDaemon),
	);
	close = async () => {
		toDaemon.end();
		await serving;
		await app.value.stop();
		await repo.close();
	};
	return c;
};

describe("mete daemon run.transcript (ADR-125)", () => {
	it("answers a finished run's steps and not_found for an unknown run", async () => {
		const c = await serve();
		const completed = new Promise<void>((resolve) =>
			c.onNotification(DAEMON_METHODS.event, (e: { type: string }) => {
				if (e.type === "run.completed") resolve();
			}),
		);
		c.listen();
		const { runId } = DaemonRunStartResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.runStart, {
				goal: "read a.txt",
				templateId: null,
			}),
		);
		await completed;
		const t = TranscriptSchema.parse(
			await c.sendRequest(DAEMON_METHODS.runTranscript, { runId }),
		);
		expect(t.conversations[0]?.steps[0]?.toolCalls[0]).toMatchObject({
			name: "fs_read",
			args: '{"path":"a.txt"}',
			result: { ok: true },
		});
		const unknown = await c
			.sendRequest(DAEMON_METHODS.runTranscript, { runId: crypto.randomUUID() })
			.then(
				() => undefined,
				(e: unknown) => e,
			);
		expect(unknown).toBeInstanceOf(ResponseError);
		if (!(unknown instanceof ResponseError)) return;
		expect(unknown.code).toBe(DAEMON_ERROR_CODE);
		expect(DaemonErrorDataSchema.parse(unknown.data).code).toBe("not_found");
	});
});
