import { tmpdir } from "node:os";
import { McpServerSchema, ok, type SecretStore } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createCalls } from "../src/application/calls.js";
import { createSessions } from "../src/application/sessions.js";
import { createCredentialFields } from "../src/infrastructure/credential-fields.js";
import { openTransport } from "../src/infrastructure/transport.js";

const server = McpServerSchema.parse({
	id: "sse-fixture",
	transport: "sse",
	url: "https://sse.example/events",
	credentialFields: [
		{ kind: "header", name: "X-Fixture-Key", required: true, secret: true },
	],
});
const signal = new AbortController().signal;
const scriptedSse = () => {
	const requests: Request[] = [];
	let events: ReadableStreamDefaultController<Uint8Array> | undefined;
	let ended = false;
	const encoder = new TextEncoder();
	const send = (text: string) => {
		if (!ended) events?.enqueue(encoder.encode(text));
	};
	const close = () => {
		if (!ended) {
			ended = true;
			events?.close();
		}
	};
	const schema = z.object({
		id: z.union([z.number(), z.string()]).optional(),
		method: z.string(),
	});
	const fake: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		expect(request.headers.get("X-Fixture-Key")).toBe("private-sse-sentinel");
		if (request.method === "GET") {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					events = controller;
				},
				cancel() {
					ended = true;
				},
			});
			send("event: endpoint\ndata: /messages?session=fixture\n\n");
			request.signal.addEventListener("abort", close, { once: true });
			return new Response(body, {
				headers: { "content-type": "text/event-stream" },
			});
		}
		expect(request.url).toBe("https://sse.example/messages?session=fixture");
		const rpc = schema.parse(await request.json());
		if (rpc.id !== undefined) {
			const result =
				rpc.method === "initialize"
					? {
							protocolVersion: "2025-11-25",
							capabilities: { tools: {} },
							serverInfo: { name: "offline", version: "1" },
						}
					: { tools: [] };
			send(
				`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`,
			);
		}
		return new Response(null, { status: 202 });
	};
	return { fetch: fake, requests, close };
};

describe("SDK authenticated SSE endpoint binding", () => {
	it("sends a saved header to the advertised session POST endpoint only", async () => {
		const data = new Map<string, string>();
		const secrets: SecretStore = {
			get: async (name) => ok(data.get(name)),
			set: async (name, value) => ok(void data.set(name, value)),
			delete: async (name) => ok(data.delete(name)),
		};
		const credentials = createCredentialFields(secrets, tmpdir());
		expect(
			(
				await credentials.save(
					{
						expected: server,
						fields: server.credentialFields ?? [],
						values: { "header:X-Fixture-Key": "private-sse-sentinel" },
					},
					signal,
				)
			).ok,
		).toBe(true);
		const fixture = scriptedSse();
		const sessions = createSessions({
			moduleId: "mcp",
			version: "0",
			workspaceDir: tmpdir(),
			servers: [server],
			calls: createCalls(),
			open: openTransport,
			secrets,
			fetch: fixture.fetch,
			logger: { debug() {}, info() {}, warn() {}, error() {} },
		});
		try {
			expect((await sessions.get(server.id, signal)).ok).toBe(true);
			expect(
				fixture.requests.filter((request) => request.method === "POST").length,
			).toBeGreaterThanOrEqual(2);
		} finally {
			await sessions.close();
			fixture.close();
		}
	});
});
