import { type ChatMessage, parseTemplate } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { keepMessages, teamOf } from "../../src/domain/team.js";
import { conversationsOf, cut, stepsOf } from "../../src/domain/transcript.js";

const opening: ChatMessage[] = [
	{ role: "system", content: "You are the writer." },
	{ role: "user", content: "Your task: write it" },
];

const template = () => {
	const r = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "duo", name: "Duo", version: "1.0.0" },
		pattern: "pipeline",
		roles: [
			{
				id: "finder",
				name: "Finder",
				goal: "Find",
				tier: "fast",
				capabilities: [],
			},
			{
				id: "writer",
				name: "Writer",
				goal: "Write",
				tier: "fast",
				capabilities: [],
			},
		],
		tasks: [
			{ id: "find", role: "finder", title: "Find" },
			{ id: "write", role: "writer", title: "Write", context: ["find"] },
		],
	});
	if (!r.ok) throw new Error(r.error.issues.join("; "));
	return r.value;
};

describe("a run's transcript (ADR-125)", () => {
	it("takes a team's kept task conversations and the active one from the run", () => {
		const team = keepMessages(teamOf(template()), "find", [
			...opening,
			{ role: "assistant", content: "found it" },
		]);
		const conversations = conversationsOf({
			team,
			task: "write",
			messages: [...opening, { role: "assistant", content: "wrote it" }],
		});
		expect(conversations).toEqual([
			{
				taskId: team.tasks.find?.id,
				roleId: "finder",
				steps: [{ text: "found it", toolCalls: [] }],
			},
			{
				taskId: team.tasks.write?.id,
				roleId: "writer",
				steps: [{ text: "wrote it", toolCalls: [] }],
			},
		]);
	});

	it("marks a summary of earlier turns and pairs a call with its result", () => {
		const steps = stepsOf([
			...opening,
			{ role: "user", content: "<summary> Earlier turns ...</summary>" },
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "c1", name: "fs_read", args: { path: "a.md" } }],
			},
			{
				role: "tool",
				toolCallId: "c1",
				content: JSON.stringify({
					ok: false,
					error: { code: "io", message: "gone" },
				}),
			},
		]);
		expect(steps).toEqual([
			{
				text: "<summary> Earlier turns ...</summary>",
				toolCalls: [],
				from: "summary",
			},
			{
				toolCalls: [
					{
						name: "fs_read",
						args: '{"path":"a.md"}',
						result: { ok: false, text: "gone" },
					},
				],
			},
		]);
	});

	it("cuts a long field and says how much it cut", () => {
		expect(cut("abcdef", 4)).toBe("abcd [2 characters cut]");
	});
});
