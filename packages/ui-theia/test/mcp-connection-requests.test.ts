import { McpServerSchema } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { mcpConnectionRequests } from "../src/infrastructure/mcp-connection-requests.js";
import type { Send } from "../src/infrastructure/settings-requests.js";

describe("captured MCP sign-in cancellation", () => {
	it("does not start an old workspace daemon to cancel an already retired flow", async () => {
		const called = vi.fn();
		const send: Send = async () => {
			called();
			throw new Error("Unexpected daemon request");
		};
		const requests = mcpConnectionRequests(send, () => false);
		const result = await requests.mcpConnection("/old", {
			op: "cancel",
			attemptId: "11111111-1111-4111-8111-111111111111",
			expected: McpServerSchema.parse({
				id: "remote",
				transport: "sse",
				url: "https://example.test/mcp",
				auth: "oauth",
			}),
		});
		expect(result.ok).toBe(false);
		expect(called).not.toHaveBeenCalled();
	});
});
