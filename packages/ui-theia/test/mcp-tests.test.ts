import { describe, expect, it } from "vitest";
import type { DaemonFailure, McpTest } from "../src/domain/status-service.js";
import { McpTests } from "../src/infrastructure/mcp-tests.js";

// A server's Test from the MCP card (ADR-164): one mete/mcp.test on the click; a refused request
// means METE has not loaded the server.

type Answer =
	| { ok: true; value: McpTest }
	| { ok: false; error: DaemonFailure };

const setup = (answer: Answer) => {
	const asked: string[] = [];
	let changes = 0;
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tests = new McpTests({
		test: async (id) => {
			asked.push(id);
			await held;
			return answer;
		},
		onChange: () => {
			changes += 1;
		},
	});
	return { tests, asked, release, changes: () => changes };
};

const LISTED: McpTest = {
	id: "demo",
	ok: true,
	tools: ["echo", "add"],
	ms: 412,
};

describe("a server's Test from the MCP card", () => {
	it("asks once while testing, then keeps the answer under the server's id", async () => {
		const { tests, asked, release } = setup({ ok: true, value: LISTED });
		expect(tests.stateOf("demo")).toEqual({ kind: "idle" });
		const first = tests.test("demo");
		expect(tests.stateOf("demo")).toEqual({ kind: "testing" });
		const second = tests.test("demo");
		release();
		await Promise.all([first, second]);
		expect(asked).toEqual(["demo"]);
		expect(tests.stateOf("demo")).toEqual({ kind: "done", answer: LISTED });
		expect(tests.stateOf("other")).toEqual({ kind: "idle" });
	});

	it("keeps the daemon's failure answer, and a refusal as not loaded with its reason", async () => {
		const failed: McpTest = {
			id: "remote",
			ok: false,
			failed: { code: "io", message: "MCP server remote: you need to sign in" },
		};
		const a = setup({ ok: true, value: failed });
		a.release();
		await a.tests.test("remote");
		expect(a.tests.stateOf("remote")).toEqual({ kind: "done", answer: failed });
		const b = setup({
			ok: false,
			error: { code: "refused", detail: "no MCP server later in mcp.yaml" },
		});
		b.release();
		await b.tests.test("later");
		expect(b.tests.stateOf("later")).toEqual({
			kind: "not_loaded",
			detail: "no MCP server later in mcp.yaml",
		});
		const c = setup({
			ok: false,
			error: { code: "cli", detail: "exit code 1" },
		});
		c.release();
		await c.tests.test("demo");
		expect(c.tests.stateOf("demo").kind).toBe("failed");
	});

	it("asks nothing for a card without an id, and forgets every answer on reset", async () => {
		const { tests, asked, release, changes } = setup({
			ok: true,
			value: LISTED,
		});
		release();
		await tests.test("");
		expect(asked).toEqual([]);
		await tests.test("demo");
		const before = changes();
		tests.reset();
		expect(tests.stateOf("demo")).toEqual({ kind: "idle" });
		expect(changes()).toBe(before + 1);
	});
});
