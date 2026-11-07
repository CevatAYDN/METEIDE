import { err, McpCredentialWriteSchema, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { createMcpCredentialService } from "../src/infrastructure/mcp-credential-service.js";
import type { RunCli } from "../src/infrastructure/spawn-cli.js";

const input = McpCredentialWriteSchema.parse({
	expected: { id: "remote", transport: "sse", url: "https://example.test/mcp" },
	fields: [{ kind: "header", name: "X-Key", required: true, secret: true }],
	values: { "header:X-Key": "private-sentinel" },
});
describe("MCP credential backend", () => {
	it("does not pass the secret on argv or echo subprocess errors", async () => {
		const run = vi.fn<RunCli>(async () => ({
			code: 1,
			stdout: "private-sentinel",
			stderr: "private-sentinel",
		}));
		const service = createMcpCredentialService({
			run,
			restartIdle: async () => ok(null),
		});
		const result = await service.set("/workspace", input);
		expect(run.mock.calls[0]?.[0]).toEqual(["mcp-key", "set", "/workspace"]);
		expect(run.mock.calls[0]?.[1]).toContain("private-sentinel");
		expect(JSON.stringify(result)).not.toContain("private-sentinel");
	});
	it("never writes when idle admission fails", async () => {
		const run = vi.fn();
		const service = createMcpCredentialService({
			run,
			restartIdle: async () =>
				err({ code: "refused", detail: "Work is active" }),
		});
		expect((await service.set("/workspace", input)).ok).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});
});
