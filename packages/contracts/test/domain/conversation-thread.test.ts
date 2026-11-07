import { describe, expect, it } from "vitest";
import {
	ThreadReplyInputSchema,
	ThreadStartedSchema,
	ThreadStartInputSchema,
} from "../../src/domain/conversation-thread.js";

const requestId = crypto.randomUUID();
const conversationId = crypto.randomUUID();
const runId = crypto.randomUUID();

describe("conversation.thread@1 mutations", () => {
	it("requires an intent id and normalizes start fields without accepting caller history", () => {
		expect(
			ThreadStartInputSchema.parse({ requestId, goal: " hello " }),
		).toEqual({
			requestId,
			goal: "hello",
			capabilities: [],
		});
		for (const bad of [
			{ goal: "hello" },
			{ requestId: "id", goal: "hello" },
			{ requestId, goal: " " },
			{ requestId, goal: "hello", messages: [] },
			{ requestId, goal: "hello", conversationId },
		])
			expect(ThreadStartInputSchema.safeParse(bad).success).toBe(false);
	});

	it("requires the exact expected head and preserves an omitted tool override", () => {
		const input = {
			conversationId,
			expectedRunId: runId,
			requestId,
			message: " next ",
		};
		expect(ThreadReplyInputSchema.parse(input)).toEqual({
			...input,
			message: "next",
		});
		for (const bad of [
			{ ...input, expectedRunId: undefined },
			{ ...input, conversationId: "id" },
			{ ...input, requestId: "" },
			{ ...input, message: " " },
			{ ...input, capabilities: ["fs.write@1"] },
			{ ...input, capabilities: ["web.fetch@1", "web.fetch@1"] },
			{ ...input, tainted: false },
		])
			expect(ThreadReplyInputSchema.safeParse(bad).success).toBe(false);
		expect(
			ThreadReplyInputSchema.parse({ ...input, capabilities: [] }).capabilities,
		).toEqual([]);
	});

	it("returns strict persisted thread and run identities", () => {
		expect(ThreadStartedSchema.parse({ conversationId, runId })).toEqual({
			conversationId,
			runId,
		});
		expect(
			ThreadStartedSchema.safeParse({ conversationId, runId, extra: true })
				.success,
		).toBe(false);
		expect(ThreadStartedSchema.safeParse({ runId }).success).toBe(false);
	});
});
