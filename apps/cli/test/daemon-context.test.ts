import { PassThrough } from "node:stream";
import {
	type ContextSnapshot,
	type ConversationThreadV2Adapter,
	DAEMON_METHODS,
	err,
	ok,
} from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { serveConversationContext } from "../src/application/daemon-context.js";

const draft = { path: "src/app.ts", content: "const n = 1;", modified: true };
const snapshot = { ...draft, sha256: "a".repeat(64) };
const runId = crypto.randomUUID();
const requestId = crypto.randomUUID();
const start = { requestId, goal: "Review", attachments: [snapshot] };
const port = (): ConversationThreadV2Adapter => ({
	start: async () => ok({ conversationId: runId, runId }),
	reply: async () => ok({ conversationId: runId, runId }),
	prepare: async () => ok(snapshot),
	context: async () => ok({ runId, attachments: [snapshot] }),
	list: async () => ok({ conversations: [] }),
	read: async () => err({ code: "not_found", message: "missing" }),
});

const served = (adapter?: ConversationThreadV2Adapter) => {
	const registry = createCapabilityRegistry(() => []);
	if (adapter)
		registry.provide("conversation.thread@2", {
			id: "fixture",
			trust: "core",
			features: [],
			impl: adapter,
		});
	const input = new PassThrough();
	const output = new PassThrough();
	const server = createMessageConnection(
		new StreamMessageReader(input),
		new StreamMessageWriter(output),
	);
	const handlers = serveConversationContext(server, { registry });
	server.listen();
	const client = createMessageConnection(
		new StreamMessageReader(output),
		new StreamMessageWriter(input),
	);
	client.listen();
	return {
		client,
		registry,
		close() {
			handlers.dispose();
			client.dispose();
			server.dispose();
			input.destroy();
			output.destroy();
		},
	};
};

describe("editor context daemon boundary", () => {
	it("refuses a malformed result envelope", async () => {
		const t = served({
			...port(),
			prepare: async () => null,
		} as unknown as ConversationThreadV2Adapter);
		try {
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadContextPrepare, draft),
			).rejects.toMatchObject({
				message: "Context request failed.",
				data: { code: "failed" },
			});
		} finally {
			t.close();
		}
	});

	it("does not forward unsupported error variants or extra error payload fields", async () => {
		const adapter = port();
		adapter.start = async () =>
			err({
				code: "choose_template",
				message: "rejected",
				suggestions: ["TOKEN_PRIVATE"],
			});
		const t = served(adapter);
		t.registry.provide("secrets.mask@1", {
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
		try {
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadContextStart, start),
			).rejects.toMatchObject({
				message: "Context request failed.",
				data: { code: "failed" },
			});
			adapter.start = async () =>
				err({
					code: "failed",
					message: "rejected",
					TOKEN_PRIVATE: true,
				});
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadContextStart, start),
			).rejects.toMatchObject({
				message: "Context request failed.",
				data: { code: "failed" },
			});
		} finally {
			t.close();
		}
	});

	it("routes all four new requests with strict output shapes", async () => {
		const adapter = port();
		const reply = vi.spyOn(adapter, "reply");
		const t = served(adapter);
		try {
			expect(
				await t.client.sendRequest(DAEMON_METHODS.threadContextPrepare, draft),
			).toEqual(snapshot);
			expect(
				await t.client.sendRequest(DAEMON_METHODS.threadContextStart, start),
			).toEqual({ conversationId: runId, runId });
			const input = {
				requestId,
				conversationId: runId,
				expectedRunId: runId,
				message: "next",
				attachments: [snapshot],
			};
			expect(
				await t.client.sendRequest(DAEMON_METHODS.threadContextReply, input),
			).toEqual({ conversationId: runId, runId });
			expect(reply).toHaveBeenCalledWith(input);
			expect(
				await t.client.sendRequest(DAEMON_METHODS.threadContextRead, { runId }),
			).toEqual({ runId, attachments: [snapshot] });
		} finally {
			t.close();
		}
	});

	it("validates before resolution, hides unknown keys, and never downgrades", async () => {
		const t = served();
		const legacy = vi.fn();
		t.registry.provide("conversation.thread@1", {
			id: "legacy",
			trust: "core",
			features: [],
			impl: { start: legacy },
		});
		try {
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadContextPrepare, {
					...draft,
					TOKEN_PRIVATE: true,
				}),
			).rejects.toMatchObject({
				code: -32602,
				message: "Invalid context request.",
			});
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadContextStart, start),
			).rejects.toMatchObject({ data: { code: "not_supported" } });
			expect(legacy).not.toHaveBeenCalled();
		} finally {
			t.close();
		}
	});

	it("masks failures and rejects malformed adapter output without echoing payloads", async () => {
		const adapter = port();
		adapter.start = async () =>
			err({ code: "failed", message: "TOKEN_PRIVATE" });
		adapter.prepare = async () =>
			ok({ ...snapshot, sha256: "TOKEN_PRIVATE" } as ContextSnapshot);
		const t = served(adapter);
		t.registry.provide("secrets.mask@1", {
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
		try {
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadContextStart, start),
			).rejects.toMatchObject({
				message: "[SECRET]",
				data: { code: "failed" },
			});
			await expect(
				t.client.sendRequest(DAEMON_METHODS.threadContextPrepare, draft),
			).rejects.toMatchObject({ message: "Invalid context response." });
		} finally {
			t.close();
		}
	});

	it("never leaks thrown adapter or masker errors", async () => {
		const adapter = port();
		adapter.prepare = async () => {
			throw new Error("TOKEN_PRIVATE");
		};
		adapter.start = async () =>
			err({ code: "failed", message: "TOKEN_PRIVATE" });
		const t = served(adapter);
		t.registry.provide("secrets.mask@1", {
			id: "mask",
			trust: "core",
			features: [],
			impl: {
				mask: async () => {
					throw new Error("TOKEN_PRIVATE");
				},
			},
		});
		try {
			for (const [method, input] of [
				[DAEMON_METHODS.threadContextPrepare, draft],
				[DAEMON_METHODS.threadContextStart, start],
			] as const)
				await expect(t.client.sendRequest(method, input)).rejects.toMatchObject(
					{ message: "Context request failed.", data: { code: "failed" } },
				);
		} finally {
			t.close();
		}
	});
});
