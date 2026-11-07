import { tmpdir } from "node:os";
import { McpServerSchema, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { createCalls } from "../src/application/calls.js";
import { createMcpConnection } from "../src/application/mcp-connection.js";

const server = McpServerSchema.parse({
	id: "remote",
	transport: "streamable-http",
	url: "https://example.test/mcp",
	auth: "oauth",
});
const setup = () => {
	const values = new Map<string, string>();
	const open = vi.fn();
	const retire = vi.fn(async () => {});
	const connection = createMcpConnection({
		sessionDeps: {
			workspaceDir: tmpdir(),
			servers: [server],
			open,
			moduleId: "mcp",
			version: "0",
			calls: createCalls(),
			logger: { info() {}, warn() {}, error() {}, debug() {} },
			secrets: {
				get: async (name) => ok(values.get(name)),
				set: async (name, value) => ok(void values.set(name, value)),
				delete: async (name) => ok(values.delete(name)),
			},
		},
		retire,
	});
	return { connection, open, retire };
};
describe("MCP user connection management", () => {
	it("status is local and credentials do not imply a connection", async () => {
		const { connection, open, retire } = setup();
		expect(
			await connection.adapter.status(server, new AbortController().signal),
		).toMatchObject({
			ok: true,
			value: { phase: "needs_sign_in", fields: [] },
		});
		expect(open).not.toHaveBeenCalled();
		expect(retire).not.toHaveBeenCalled();
		await connection.close();
	});
	it("rejects stale targets and does not invent an authorization for a different endpoint", async () => {
		const { connection, open } = setup();
		expect(
			(
				await connection.adapter.start(
					{ ...server, id: "other" },
					new AbortController().signal,
				)
			).ok,
		).toBe(false);
		expect(open).not.toHaveBeenCalled();
	});
	it("refuses cancellation without the captured pending attempt", async () => {
		const { connection } = setup();
		expect(
			(
				await connection.adapter.cancel(
					server,
					"11111111-1111-4111-8111-111111111111",
				)
			).ok,
		).toBe(false);
	});
});
