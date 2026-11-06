import { PassThrough } from "node:stream";
import { DAEMON_METHODS, RunReplyOutputSchema } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import {
	createMessageConnection,
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

it("continues a conversation through mete/run.reply and refuses malformed params", async () => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
		secrets: memorySecrets(),
		providers: [
			scriptedProvider({
				script: [
					[
						{ type: "text", text: "hello" },
						{
							type: "finish",
							reason: "stop",
							usage: { prompt: 1, completion: 1 },
						},
					],
				],
			}),
		],
	});
	if (!app.ok) throw new Error("app");
	const input = new PassThrough();
	const output = new PassThrough();
	const serving = daemonCommand(
		app.value,
		recordingIo().io,
		repo.workspaceDir,
		{ input, output },
	);
	const client = createMessageConnection(
		new StreamMessageReader(output),
		new StreamMessageWriter(input),
	);
	client.onNotification(DAEMON_METHODS.event, () => {});
	client.listen();
	try {
		const first = RunReplyOutputSchema.parse(
			await client.sendRequest(DAEMON_METHODS.runStart, {
				goal: "selam",
				templateId: null,
			}),
		);
		await vi.waitFor(async () =>
			expect(
				await client.sendRequest(DAEMON_METHODS.status, { runId: first.runId }),
			).toMatchObject([{ status: "completed" }]),
		);
		const next = RunReplyOutputSchema.parse(
			await client.sendRequest(DAEMON_METHODS.runReply, {
				runId: first.runId,
				message: "nasilsin?",
			}),
		);
		expect(next.runId).not.toBe(first.runId);
		await vi.waitFor(async () =>
			expect(
				await client.sendRequest(DAEMON_METHODS.status, { runId: next.runId }),
			).toMatchObject([{ status: "completed" }]),
		);
		const transcript = await client.sendRequest(DAEMON_METHODS.runTranscript, {
			runId: next.runId,
		});
		expect(JSON.stringify(transcript)).toContain("nasilsin?");
		await expect(
			client.sendRequest(DAEMON_METHODS.runReply, {
				runId: next.runId,
				message: " ",
			}),
		).rejects.toMatchObject({ code: -32602 });
	} finally {
		input.end();
		await serving;
		client.dispose();
		await app.value.stop();
		await repo.close();
	}
});
