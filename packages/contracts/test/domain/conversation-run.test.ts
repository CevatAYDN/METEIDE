import { describe, expect, it } from "vitest";
import {
	ConversationCapabilitiesSchema,
	ConversationReplyInputSchema,
	ConversationRunOutputSchema,
	ConversationStartInputSchema,
} from "../../src/domain/conversation-run.js";

describe("conversation.run@1", () => {
	it("defaults a start to baseline tools and preserves an absent reply override", () => {
		expect(ConversationStartInputSchema.parse({ goal: " hello " })).toEqual({
			goal: "hello",
			capabilities: [],
		});
		expect(
			ConversationReplyInputSchema.parse({ runId: "old", message: " next " }),
		).toEqual({ runId: "old", message: "next" });
		expect(
			ConversationStartInputSchema.parse({
				goal: "hello",
				prefer: { providerId: "p", modelId: "m" },
				capabilities: ["web.search@1", "web.fetch@1", "mcp.tools@1"],
			}).capabilities,
		).toEqual(["web.search@1", "web.fetch@1", "mcp.tools@1"]);
		expect(ConversationRunOutputSchema.parse({ runId: "new" })).toEqual({
			runId: "new",
		});
	});

	it("refuses duplicate or unapproved capabilities and caller-owned history", () => {
		for (const capabilities of [
			["web.search@1", "web.search@1"],
			["fs.write@1"],
			["mcp.server@1"],
			["web.search@2"],
			null,
		])
			expect(
				ConversationCapabilitiesSchema.safeParse(capabilities).success,
			).toBe(false);
		for (const input of [
			{ goal: " " },
			{ goal: "hi", templateId: null },
			{ goal: "hi", prefer: { assistant: { providerId: "p", modelId: "m" } } },
		])
			expect(ConversationStartInputSchema.safeParse(input).success).toBe(false);
		for (const input of [
			{ runId: "", message: "hi" },
			{ runId: "old", message: " " },
			{ runId: "old", message: "hi", messages: [] },
		])
			expect(ConversationReplyInputSchema.safeParse(input).success).toBe(false);
		expect(
			ConversationReplyInputSchema.parse({
				runId: "old",
				message: "hi",
				capabilities: [],
			}).capabilities,
		).toEqual([]);
		expect(
			ConversationRunOutputSchema.safeParse({ runId: "new", extra: true })
				.success,
		).toBe(false);
	});
});
