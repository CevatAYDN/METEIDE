import { tmpdir } from "node:os";
import { type McpServer, ok, type SecretStore } from "@mete/contracts";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCalls } from "../src/application/calls.js";
import type { Sample } from "../src/application/sampling.js";
import { createSessions, type Elicit } from "../src/application/sessions.js";
import { createCredentialFields } from "../src/infrastructure/credential-fields.js";

const secret = "callback-private-token";
const signal = new AbortController().signal;
const cleanup: (() => Promise<void>)[] = [];
const setup = async (value = secret) => {
	const values = new Map<string, string>();
	const secrets: SecretStore = {
		get: async (name) => ok(values.get(name)),
		set: async (name, text) => {
			values.set(name, text);
			return ok(undefined);
		},
		delete: async (name) => ok(values.delete(name)),
	};
	const target: McpServer = {
		id: "fixture",
		transport: "stdio",
		runtime: "node",
		command: "unused",
		args: [],
		permissions: [],
		credentialFields: [
			{ kind: "env", name: "TOKEN", secret: true, required: true },
		],
	};
	const saved = await createCredentialFields(secrets, tmpdir()).save(
		{
			expected: target,
			fields: target.credentialFields ?? [],
			values: { "env:TOKEN": value },
		},
		signal,
	);
	if (!saved.ok) throw new Error("Credential fixture failed");
	const [ours, theirs] = InMemoryTransport.createLinkedPair();
	const server = new Server(
		{ name: "fixture", version: "1" },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler("tools/list", () => ({ tools: [] }));
	await server.connect(theirs);
	const sample = vi.fn<Sample>(async () => ({
		role: "assistant",
		content: { type: "text", text: "safe reply" },
		model: "fixture",
	}));
	const elicit = vi.fn<Elicit>(async () => ({ action: "decline" }));
	const sessions = createSessions({
		moduleId: "mcp",
		version: "1",
		workspaceDir: tmpdir(),
		servers: [target],
		secrets,
		open: () => ({ transport: ours, stderr: () => "" }),
		sample,
		elicit,
		calls: createCalls(),
		logger: { info() {}, warn() {}, error() {}, debug() {} },
	});
	cleanup.push(async () => {
		await sessions.close();
		await server.close();
	});
	expect((await sessions.get(target.id, signal)).ok).toBe(true);
	return { server, sample, elicit };
};
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

describe("session callback redaction", () => {
	it("scrubs nested sampling strings while retaining safe request fields", async () => {
		const { server, sample } = await setup();
		await server.createMessage({
			messages: [{ role: "user", content: { type: "text", text: secret } }],
			systemPrompt: secret,
			maxTokens: 23,
			temperature: 0.2,
			includeContext: "none",
			stopSequences: ["stop", secret],
			modelPreferences: { intelligencePriority: 0.6 },
			metadata: { title: "safe", nested: [secret, { token: secret }] },
			_meta: { trace: "safe", token: secret },
		});
		expect(sample.mock.calls[0]?.[0]).toBe("fixture");
		const sent = sample.mock.calls[0]?.[1];
		expect(sent).toMatchObject({
			messages: [
				{ role: "user", content: { type: "text", text: "[REDACTED]" } },
			],
			systemPrompt: "[REDACTED]",
			maxTokens: 23,
			temperature: 0.2,
			includeContext: "none",
			stopSequences: ["stop", "[REDACTED]"],
			modelPreferences: { intelligencePriority: 0.6 },
			metadata: {
				title: "safe",
				nested: ["[REDACTED]", { token: "[REDACTED]" }],
			},
			_meta: { trace: "safe", token: "[REDACTED]" },
		});
		expect(JSON.stringify(sent)).not.toContain(secret);
		expect(server.getClientCapabilities()).toMatchObject({
			sampling: {},
			elicitation: { form: {} },
		});
	});

	it("scrubs form prompts, defaults and descriptions before terminal/UI callbacks", async () => {
		const { server, elicit } = await setup();
		const result = await server.elicitInput({
			mode: "form",
			message: secret,
			requestedSchema: {
				type: "object",
				properties: {
					label: {
						type: "string",
						title: "Safe title",
						description: secret,
						default: secret,
					},
				},
				required: ["label"],
			},
			_meta: { nested: { token: secret }, safe: "retained" },
		});
		expect(result.action).toBe("decline");
		expect(elicit.mock.calls[0]?.[1]).toMatchObject({
			mode: "form",
			message: "[REDACTED]",
			requestedSchema: {
				type: "object",
				properties: {
					label: {
						type: "string",
						title: "Safe title",
						description: "[REDACTED]",
						default: "[REDACTED]",
					},
				},
				required: ["label"],
			},
			_meta: { nested: { token: "[REDACTED]" }, safe: "retained" },
		});
		expect(JSON.stringify(elicit.mock.calls)).not.toContain(secret);
	});

	it("fails closed when redaction makes sampling parameters invalid", async () => {
		const { server, sample } = await setup("none");
		await expect(
			server.createMessage({
				messages: [{ role: "user", content: { type: "text", text: "safe" } }],
				maxTokens: 1,
				includeContext: "none",
			}),
		).rejects.toThrow(/callback payload/i);
		expect(sample).not.toHaveBeenCalled();
	});

	it("fails closed when redaction makes the form schema invalid", async () => {
		const { server, elicit } = await setup("string");
		await expect(
			server.elicitInput({
				mode: "form",
				message: "Safe",
				requestedSchema: {
					type: "object",
					properties: { label: { type: "string" } },
				},
			}),
		).rejects.toThrow(/callback payload/i);
		expect(elicit).not.toHaveBeenCalled();
	});
});
