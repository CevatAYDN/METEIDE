import { describe, expect, it } from "vitest";
import {
	DaemonMcpTestParamsSchema,
	DaemonMcpTestResultSchema,
} from "../../src/domain/daemon-mcp.js";

describe("mete/mcp.test (ADR-164)", () => {
	it("asks for one server by its id", () => {
		expect(DaemonMcpTestParamsSchema.parse({ id: "demo" })).toEqual({
			id: "demo",
		});
		for (const bad of [{}, { id: "" }, { id: "demo", tool: "echo" }])
			expect(DaemonMcpTestParamsSchema.safeParse(bad).success).toBe(false);
	});

	it("answers the tools the server lists, or why it failed", () => {
		const listed = { id: "demo", ok: true, tools: ["echo", "add"], ms: 412 };
		expect(DaemonMcpTestResultSchema.parse(listed)).toEqual(listed);
		const none = { id: "demo", ok: true, tools: [], ms: 0 };
		expect(DaemonMcpTestResultSchema.parse(none)).toEqual(none);
		const failed = {
			id: "remote",
			ok: false,
			failed: { code: "io", message: "MCP server remote: you need to sign in" },
		};
		expect(DaemonMcpTestResultSchema.parse(failed)).toEqual(failed);
		for (const bad of [
			{ id: "demo", ok: true, tools: ["echo"] },
			{ id: "demo", ok: true, tools: [""], ms: 1 },
			{ id: "demo", ok: true, tools: [], ms: -1 },
			{ id: "demo", ok: false, tools: [], ms: 1 },
			{ id: "demo", ok: false, failed: { code: "", message: "x" } },
			{ ok: true, tools: [], ms: 1 },
		])
			expect(DaemonMcpTestResultSchema.safeParse(bad).success).toBe(false);
	});
});
