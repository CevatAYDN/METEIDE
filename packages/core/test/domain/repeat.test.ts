import type { ChatMessage, ToolCall } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { guarded } from "../../src/domain/repeat.js";
import {
	EXTERNAL_LABEL,
	REPEAT_LABEL,
	resultJson,
} from "../../src/domain/tools.js";

// Every turn reuses the id c0, as some providers and the engine harness do.
const call = (args: unknown, name = "fs_read"): ToolCall => ({
	id: "c0",
	name,
	args,
});
const turn = (c: ToolCall, content: string): ChatMessage[] => [
	{ role: "assistant", content: "", toolCalls: [c] },
	{ role: "tool", toolCallId: c.id, content },
];
const tool = (content: string) => ({
	role: "tool" as const,
	toolCallId: "c0",
	content,
});
// The conversation before the current call, whose own reply is the last message.
const before = (...turns: ChatMessage[][]): ChatMessage[] => [
	{ role: "user", content: "fix it" },
	...turns.flat(),
];
const labeled = (
	messages: ChatMessage[],
	c: ToolCall,
	content: string,
): boolean =>
	guarded(
		[...messages, { role: "assistant", content: "", toolCalls: [c] }],
		c,
		tool(content),
	).content.startsWith(`${REPEAT_LABEL}\n`);

const a = call({ path: "a", limit: 5 });

describe("repeat guard (ADR-166)", () => {
	it("labels the third same call with the same result, and every one after", () => {
		expect(labeled(before(turn(a, "x")), a, "x")).toBe(false);
		expect(labeled(before(turn(a, "x"), turn(a, "x")), a, "x")).toBe(true);
		const third = guarded(
			[
				...before(turn(a, "x"), turn(a, "x")),
				{ role: "assistant", content: "", toolCalls: [a] },
			],
			a,
			tool("x"),
		).content;
		expect(third).toBe(`${REPEAT_LABEL}\nx`);
		expect(
			labeled(before(turn(a, "x"), turn(a, "x"), turn(a, third)), a, "x"),
		).toBe(true);
	});

	it("takes the arguments in any key order", () => {
		const b = call({ limit: 5, path: "a" });
		expect(labeled(before(turn(a, "x"), turn(b, "x")), a, "x")).toBe(true);
		const deep = call({ o: { y: 1, x: [{ q: 1, p: 2 }] } });
		const same = call({ o: { x: [{ p: 2, q: 1 }], y: 1 } });
		expect(labeled(before(turn(deep, "x"), turn(same, "x")), deep, "x")).toBe(
			true,
		);
	});

	it("starts again after a different result, as a read after a write", () => {
		expect(labeled(before(turn(a, "x"), turn(a, "y")), a, "y")).toBe(false);
		expect(labeled(before(turn(a, "x"), turn(a, "x")), a, "y")).toBe(false);
	});

	it("is not broken by other calls between, and tells tools and arguments apart", () => {
		const w = call({ path: "b" }, "fs_write");
		expect(
			labeled(before(turn(a, "x"), turn(w, "ok"), turn(a, "x")), a, "x"),
		).toBe(true);
		const other = call({ path: "b", limit: 5 });
		expect(labeled(before(turn(a, "x"), turn(other, "x")), a, "x")).toBe(false);
		const shell = call({ path: "a", limit: 5 }, "shell_exec");
		expect(labeled(before(turn(a, "x"), turn(shell, "x")), a, "x")).toBe(false);
	});

	it("counts a call only with its own turn's result", () => {
		// The middle turn's call got no result (an approval pause), so it neither counts nor breaks.
		const unanswered: ChatMessage[] = [
			{ role: "assistant", content: "", toolCalls: [a] },
			{ role: "user", content: "go on" },
		];
		expect(
			labeled(before(turn(a, "x"), unanswered, turn(a, "x")), a, "x"),
		).toBe(true);
		expect(labeled(before(turn(a, "x"), unanswered), a, "x")).toBe(false);
	});

	it("reads a result past its labels", () => {
		expect(resultJson(`${EXTERNAL_LABEL}\n{}`)).toBe("{}");
		expect(resultJson(`${REPEAT_LABEL}\n${EXTERNAL_LABEL}\n{}`)).toBe("{}");
		expect(resultJson("{}")).toBe("{}");
	});
});
