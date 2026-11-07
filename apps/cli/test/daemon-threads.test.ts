import { PassThrough } from "node:stream";
import {
	type ConversationThreadAdapter,
	DAEMON_METHODS,
	err,
	ok,
	ThreadListResultSchema,
	ThreadReadResultSchema,
	type ThreadStarted,
	ThreadStartedSchema,
} from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { serveConversationThreads } from "../src/application/daemon-threads.js";
import { createApp, engineOf } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

const served = (registry: ReturnType<typeof createCapabilityRegistry>) => {
	const input = new PassThrough();
	const output = new PassThrough();
	const server = createMessageConnection(
		new StreamMessageReader(input),
		new StreamMessageWriter(output),
	);
	const handlers = serveConversationThreads(server, { registry });
	server.listen();
	const client = createMessageConnection(
		new StreamMessageReader(output),
		new StreamMessageWriter(input),
	);
	client.listen();
	return {
		client,
		close() {
			handlers.dispose();
			client.dispose();
			server.dispose();
			input.destroy();
			output.destroy();
		},
	};
};
const requestId = () => crypto.randomUUID();

describe("thread daemon boundary", () => {
	it("validates before capability resolution and never falls back to legacy mutation", async () => {
		const registry = createCapabilityRegistry(() => []);
		const legacy = vi.fn();
		registry.provide("conversation.run@1", {
			id: "legacy",
			trust: "core",
			features: [],
			impl: { start: legacy },
		});
		const t = served(registry);
		try {
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadStart, {
					goal: "hello",
					requestId: requestId(),
					TOKEN_PRIVATE: true,
				}),
			).rejects.toMatchObject({
				code: -32602,
				message: "Invalid conversation request.",
			});
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadStart, { goal: "hello" }),
			).rejects.toMatchObject({ code: -32602 });
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadStart, {
					goal: "hello",
					requestId: requestId(),
				}),
			).rejects.toMatchObject({ data: { code: "not_supported" } });
			expect(legacy).not.toHaveBeenCalled();
		} finally {
			t.close();
		}
	});

	it("masks adapter errors and rejects malformed external results", async () => {
		const registry = createCapabilityRegistry(() => []);
		const bad = { runId: "malformed-secret" };
		const port: ConversationThreadAdapter = {
			start: async () => err({ code: "failed", message: "TOKEN_PRIVATE" }),
			reply: async () => ok(bad as ThreadStarted),
			list: async () => ok({ conversations: [] }),
			read: async () => err({ code: "not_found", message: "missing" }),
		};
		registry.provide("conversation.thread@1", {
			id: "fixture",
			trust: "core",
			features: [],
			impl: port,
		});
		registry.provide("secrets.mask@1", {
			id: "mask",
			trust: "core",
			features: [],
			impl: {
				mask: async (text: string) => ({
					text: text.replaceAll("TOKEN_PRIVATE", "[SECRET]"),
					masked: 1,
				}),
			},
		});
		const t = served(registry);
		try {
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadStart, {
					goal: "hello",
					requestId: requestId(),
				}),
			).rejects.toMatchObject({
				message: "[SECRET]",
				data: { code: "failed" },
			});
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadReply, {
					conversationId: requestId(),
					expectedRunId: requestId(),
					requestId: requestId(),
					message: "next",
				}),
			).rejects.toMatchObject({
				message: "Invalid conversation response.",
				data: { code: "failed" },
			});
		} finally {
			t.close();
		}
	});
});

it("persists one conversation across real composed starts, replies and duplicate RPC sends", async () => {
	const repo = await tempRepo({ "README.md": "# threads\n" });
	const created = await createApp({
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
	if (!created.ok) throw new Error("app failed");
	const app = created.value;
	const t = served(app.registry);
	try {
		const input = { goal: "thread title", requestId: requestId() };
		const first = ThreadStartedSchema.parse(
			await t.client.sendRequest(DAEMON_METHODS.threadStart, input),
		);
		expect(
			await t.client.sendRequest(DAEMON_METHODS.threadStart, input),
		).toEqual(first);
		await vi.waitFor(() => {
			const engine = engineOf(app);
			expect(engine.ok && engine.value.status(first.runId)).toMatchObject({
				ok: true,
				value: [{ status: "completed" }],
			});
		});
		const next = ThreadStartedSchema.parse(
			await t.client.sendRequest(DAEMON_METHODS.threadReply, {
				conversationId: first.conversationId,
				expectedRunId: first.runId,
				requestId: requestId(),
				message: "find this message",
			}),
		);
		expect(next.conversationId).toBe(first.conversationId);
		expect(next.runId).not.toBe(first.runId);
		const page = ThreadListResultSchema.parse(
			await t.client.sendRequest(DAEMON_METHODS.threadList, {
				query: "find this",
			}),
		);
		expect(page.conversations.map((row) => row.id)).toEqual([
			first.conversationId,
		]);
		const history = ThreadReadResultSchema.parse(
			await t.client.sendRequest(DAEMON_METHODS.threadRead, {
				runId: first.runId,
			}),
		);
		expect(history.turns.map((turn) => turn.id)).toEqual([
			first.runId,
			next.runId,
		]);
	} finally {
		t.close();
		await app.stop();
		await repo.close();
	}
}, 30_000);
