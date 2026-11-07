import { PassThrough } from "node:stream";
import { ConversationRunOutputSchema, DAEMON_METHODS } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { serveConversation } from "../src/application/daemon-conversation.js";
import { createApp, engineOf } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

const served = async (ready: boolean) => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	const created = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
		secrets: memorySecrets(),
		providers: ready
			? [
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
				]
			: [],
	});
	if (!created.ok) throw new Error("app");
	const app = created.value;
	const input = new PassThrough();
	const output = new PassThrough();
	const server = createMessageConnection(
		new StreamMessageReader(input),
		new StreamMessageWriter(output),
	);
	serveConversation(server, app);
	server.listen();
	const client = createMessageConnection(
		new StreamMessageReader(output),
		new StreamMessageWriter(input),
	);
	client.listen();
	return {
		app,
		client,
		close: async () => {
			client.dispose();
			server.dispose();
			input.destroy();
			output.destroy();
			await app.stop();
			await repo.close();
		},
	};
};

it("starts and replies through the explicit conversation capability", async () => {
	const t = await served(true);
	try {
		const first = ConversationRunOutputSchema.parse(
			await t.client.sendRequest(DAEMON_METHODS.conversationStart, {
				goal: "hello",
				capabilities: ["web.fetch@1"],
			}),
		);
		await vi.waitFor(() => {
			const engine = engineOf(t.app);
			expect(engine.ok && engine.value.status(first.runId)).toMatchObject({
				ok: true,
				value: [{ status: "completed" }],
			});
		});
		const next = ConversationRunOutputSchema.parse(
			await t.client.sendRequest(DAEMON_METHODS.conversationReply, {
				runId: first.runId,
				message: "next",
				capabilities: [],
			}),
		);
		expect(next.runId).not.toBe(first.runId);
		await expect(
			t.client.sendRequest(DAEMON_METHODS.conversationReply, {
				runId: "missing",
				message: "hello",
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
	} finally {
		await t.close();
	}
});

it("validates before readiness and returns the existing not_ready error", async () => {
	const t = await served(false);
	try {
		await expect(
			t.client.sendRequest(DAEMON_METHODS.conversationStart, {
				goal: "hello",
				capabilities: ["fs.write@1"],
			}),
		).rejects.toMatchObject({ code: -32602 });
		await expect(
			t.client.sendRequest(DAEMON_METHODS.conversationStart, { goal: "hello" }),
		).rejects.toMatchObject({ data: { code: "not_ready" } });
	} finally {
		await t.close();
	}
});
