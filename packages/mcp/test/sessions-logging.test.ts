import { tmpdir } from "node:os";
import type { SecretsMaskAdapter } from "@mete/contracts";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { createCalls } from "../src/application/calls.js";
import { mcpTools } from "../src/application/mcp-tools.js";
import { logProgress } from "../src/application/progress-log.js";
import { createSessions } from "../src/application/sessions.js";

const SECRET = "Bearer credential-do-not-log\nprivate prompt";
const signal = new AbortController().signal;

const setup = async (mask?: SecretsMaskAdapter) => {
	const [mine, theirs] = InMemoryTransport.createLinkedPair();
	const server = new Server(
		{ name: "fixture", version: "1" },
		{ capabilities: { tools: { listChanged: true } } },
	);
	const state = { fail: false };
	server.setRequestHandler("tools/list", () => {
		if (state.fail) throw new Error(SECRET);
		return { tools: [] };
	});
	await server.connect(theirs);
	const logs: Readonly<Record<string, unknown>>[] = [];
	const log = (fields: Readonly<Record<string, unknown>>, msg: string) => {
		logs.push({ ...fields, msg });
	};
	const logger = { error: log, warn: log, info: log, debug: log };
	const sessions = createSessions({
		moduleId: "mcp-client",
		version: "1",
		servers: [
			{
				id: "fixture",
				transport: "streamable-http",
				url: "https://fixture.example",
				auth: "none",
				permissions: [],
			},
		],
		workspaceDir: tmpdir(),
		open: () => ({ transport: mine, stderr: () => SECRET }),
		logger,
		...(mask ? { mask } : {}),
		calls: createCalls(),
	});
	const close = async () => {
		await sessions.close();
		await server.close();
	};
	return { sessions, server, state, logs, logger, close };
};

describe("MCP global logs", () => {
	it("keeps a masked progress message in the log without putting it in an event (ADR-067)", async () => {
		const info = vi.fn();
		const warn = vi.fn();
		await logProgress(
			{
				logger: { info, warn, error() {}, debug() {} },
				mask: {
					mask: async (text) => ({
						text: text.replace(SECRET, "[SECRET:x]"),
						masked: 1,
					}),
				},
			},
			{ server: "fixture", tool: "work" },
			{ progress: 1, total: 2, message: SECRET },
		);
		expect(info).toHaveBeenCalledWith(
			{
				server: "fixture",
				tool: "work",
				progress: 1,
				total: 2,
				message: "[SECRET:x]",
			},
			"MCP tool progress",
		);
		expect(JSON.stringify(info.mock.calls)).not.toContain(
			"credential-do-not-log",
		);
	});

	it("waits for masking on close and never falls back to raw text after a mask failure", async () => {
		let release: (value: { text: string; masked: number }) => void = () => {};
		const masked = new Promise<{ text: string; masked: number }>((resolve) => {
			release = resolve;
		});
		const s = await setup({ mask: () => masked });
		s.sessions
			.callOptions("fixture", "work", { signal }, "mcp.tools@1")
			.onprogress({ progress: 1, message: SECRET });
		let closed = false;
		const closing = s.close().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		release({ text: "[SECRET:x]", masked: 1 });
		await closing;
		expect(s.logs).toContainEqual(
			expect.objectContaining({ message: "[SECRET:x]" }),
		);
		const info = vi.fn();
		const warn = vi.fn();
		await logProgress(
			{
				logger: { info, warn, error() {}, debug() {} },
				mask: {
					mask: async () => {
						throw new Error(SECRET);
					},
				},
			},
			{},
			{ progress: 2, message: SECRET },
		);
		expect(warn).toHaveBeenCalledWith(
			{},
			"MCP progress message could not be masked",
		);
		expect(info).toHaveBeenCalledWith({ progress: 2 }, "MCP tool progress");
		expect(
			JSON.stringify([...s.logs, info.mock.calls, warn.mock.calls]),
		).not.toContain("credential-do-not-log");
	});

	it("omits untrusted progress messages while retaining numeric progress", async () => {
		const s = await setup();
		try {
			s.sessions
				.callOptions("fixture", "work", { signal }, "mcp.tools@1")
				.onprogress({
					progress: 1,
					total: 2,
					message: SECRET,
				});
			expect(s.logs).toEqual([
				{
					moduleId: "mcp-client",
					server: "fixture",
					tool: "work",
					progress: 1,
					total: 2,
					msg: "MCP tool progress",
				},
			]);
		} finally {
			await s.close();
		}
	});

	it("omits refresh error text and connection-close stderr", async () => {
		const s = await setup();
		try {
			expect((await s.sessions.get("fixture", signal)).ok).toBe(true);
			s.state.fail = true;
			await s.server.sendToolListChanged();
			await vi.waitFor(() =>
				expect(s.logs).toContainEqual({
					moduleId: "mcp-client",
					server: "fixture",
					msg: "MCP server tool list could not be refreshed",
				}),
			);
			await s.server.close();
			await vi.waitFor(() =>
				expect(s.logs).toContainEqual({
					moduleId: "mcp-client",
					server: "fixture",
					msg: "MCP server connection closed",
				}),
			);
			expect(JSON.stringify(s.logs)).not.toContain("credential-do-not-log");
			expect(JSON.stringify(s.logs)).not.toContain("private prompt");
		} finally {
			await s.close();
		}
	});

	it("logs only the error code when a server cannot be listed", async () => {
		const s = await setup();
		try {
			s.state.fail = true;
			const tools = mcpTools({
				adapterId: "mcp-client",
				workspaceDir: tmpdir(),
				sessions: s.sessions,
				policy: () => undefined,
				logger: s.logger,
			});
			expect(await tools.list(signal)).toEqual({ ok: true, value: [] });
			expect(s.logs).toContainEqual({
				moduleId: "mcp-client",
				server: "fixture",
				code: "io",
				msg: "MCP server skipped in list",
			});
			expect(JSON.stringify(s.logs)).not.toContain("credential-do-not-log");
		} finally {
			await s.close();
		}
	});
});
