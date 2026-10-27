import { describe, expect, it } from "vitest";
import { textCalls } from "../../src/domain/text-calls.js";

const offered = new Set(["fs_read", "fs_grep"]);

describe("tool calls written in the reply text (ADR-126)", () => {
	it("reads <tool_call> blocks and keeps the text around them", () => {
		const reply = [
			"I will read both.",
			'<tool_call>{"name": "fs_read", "arguments": {"path": "a.md"}}</tool_call>',
			'<tool_call>{"name": "fs_grep", "arguments": "{\\"pattern\\": \\"x\\"}"}</tool_call>',
		].join("\n");
		expect(textCalls(reply, offered)).toEqual({
			content: "I will read both.",
			calls: [
				{ name: "fs_read", args: { path: "a.md" } },
				{ name: "fs_grep", args: { pattern: "x" } },
			],
		});
	});

	it("reads a reply that is one JSON object, fenced or after Llama's tag", () => {
		const call = { name: "fs_read", args: { path: "a.md" } };
		expect(
			textCalls(
				'```json\n{"name": "fs_read", "parameters": {"path": "a.md"}}\n```',
				offered,
			),
		).toEqual({ content: "", calls: [call] });
		expect(
			textCalls(
				'<|python_tag|>{"name": "fs_read", "parameters": {"path": "a.md"}}',
				offered,
			),
		).toEqual({ content: "", calls: [call] });
	});

	it("leaves the reply as text when a call is broken or names a tool not offered", () => {
		const broken = '<tool_call>{"name": "fs_read", "arguments": {</tool_call>';
		const other =
			'<tool_call>{"name": "shell_exec", "arguments": {"command": "rm"}}</tool_call>';
		expect(textCalls(broken, offered)).toBeUndefined();
		expect(textCalls(other, offered)).toBeUndefined();
		expect(textCalls("The answer is 42.", offered)).toBeUndefined();
		expect(textCalls('{"name": "fs_read"}', offered)).toBeUndefined();
	});
});
