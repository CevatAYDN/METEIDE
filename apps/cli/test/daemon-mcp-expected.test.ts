import { McpServerSchema } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { matchesLoadedServer } from "../src/application/daemon-mcp.js";

describe("MCP test effective configuration check", () => {
	it("compares raw configuration only inside the daemon, including secrets and shadowed global rows", () => {
		const server = McpServerSchema.parse({
			id: "docs",
			transport: "stdio",
			runtime: "node",
			command: "npx",
			args: ["example@1"],
			env: { API_KEY: "fixture-secret" },
		});
		if (server.transport !== "stdio")
			throw new Error("Expected a local test fixture");
		const app = {
			config: {
				loadedAt: "2026-11-07T00:00:00.000Z",
				layers: {
					global: {
						file: "settings.yaml",
						sections: { mcp: { servers: [server] } },
					},
					workspace: {},
				},
			},
		};
		expect(matchesLoadedServer(app, "docs", server)).toBe(true);
		expect(
			matchesLoadedServer(app, "docs", {
				...server,
				env: { API_KEY: "different" },
			}),
		).toBe(false);
		const shadowed = {
			config: {
				...app.config,
				layers: {
					...app.config.layers,
					workspace: {
						mcp: {
							file: "mcp.yaml",
							value: { servers: [{ ...server, command: "node" }] },
						},
					},
				},
			},
		};
		expect(matchesLoadedServer(shadowed, "docs", server)).toBe(false);
	});
});
