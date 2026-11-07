import { err, McpServerSchema, ok } from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { describe, expect, it, vi } from "vitest";
import { connectionRequest } from "../src/application/daemon-mcp-connection.js";

const expected = McpServerSchema.parse({
	id: "remote",
	transport: "streamable-http",
	url: "https://example.test/mcp",
	auth: "oauth",
});
const setup = (active = false) => {
	const registry = createCapabilityRegistry(() => []);
	const state = {
		id: "remote",
		identity: "a".repeat(64),
		phase: "needs_sign_in",
		fields: [],
	};
	const status = vi.fn(async () => ok(state));
	const start = vi.fn(async () => ok({ state }));
	const prepare = vi.fn(async () =>
		active ? err({ code: "failed", message: "Work is active" }) : ok(null),
	);
	registry.provide("mcp.connection@1", {
		id: "mcp",
		features: [],
		trust: "core",
		impl: { status, start },
	});
	registry.provide("run.quiesce@1", {
		id: "core",
		features: [],
		trust: "core",
		impl: { prepare },
	});
	return {
		registry,
		start,
		status,
		prepare,
		config: {
			layers: {
				global: {
					file: "settings.yaml",
					sections: { mcp: { servers: [expected] } },
				},
				workspace: {},
			},
			loadedAt: "",
		},
	};
};
describe("MCP management admission", () => {
	it("reads status without quiescing, connecting or requiring a provider", async () => {
		const app = setup();
		expect(
			await connectionRequest(app, { op: "status", expected }),
		).toMatchObject({ state: { phase: "needs_sign_in" } });
		expect(app.prepare).not.toHaveBeenCalled();
		expect(app.start).not.toHaveBeenCalled();
	});
	it("rejects active work and stale targets before starting auth", async () => {
		const app = setup(true);
		await expect(
			connectionRequest(app, { op: "start", expected }),
		).rejects.toThrow("Work is active");
		await expect(
			connectionRequest(app, {
				op: "start",
				expected: { ...expected, url: "https://other.test" },
			}),
		).rejects.toThrow("configuration");
		expect(app.start).not.toHaveBeenCalled();
	});
	it("refuses malformed or secret-bearing requests with no raw input echo", async () => {
		const app = setup();
		await expect(
			connectionRequest(app, { op: "start", expected, secret: "sentinel" }),
		).rejects.toThrow("Invalid MCP management request");
		expect(app.prepare).not.toHaveBeenCalled();
	});
});
