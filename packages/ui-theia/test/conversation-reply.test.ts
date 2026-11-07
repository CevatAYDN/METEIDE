import { err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import { replyToConversation } from "../src/application/conversation-reply.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

it("inherits unknown saved tools, forwards explicit overrides, and keeps stale results off screen", async () => {
	const shown = { dir: "/w", runId: "old", goal: "title" };
	const show = vi.fn(async () => {});
	const started = vi.fn();
	const conversationReply = vi.fn<MeteDaemonService["conversationReply"]>(
		async () => ok({ runId: "next" }),
	);
	await replyToConversation(
		{
			daemon: { conversationReply },
			shown,
			current: () => shown,
			show,
			onStarted: started,
			capabilities: undefined,
		},
		"hello",
	);
	expect(conversationReply).toHaveBeenLastCalledWith("/w", {
		runId: "old",
		message: "hello",
	});
	expect(show).toHaveBeenCalledWith("/w", "next", "title");
	show.mockClear();
	await replyToConversation(
		{
			daemon: { conversationReply },
			shown,
			current: () => undefined,
			show,
			onStarted: started,
			capabilities: ["mcp.tools@1"],
		},
		"draft",
	);
	expect(conversationReply).toHaveBeenLastCalledWith("/w", {
		runId: "old",
		message: "draft",
		capabilities: ["mcp.tools@1"],
	});
	expect(started).toHaveBeenLastCalledWith("next", ["mcp.tools@1"]);
	expect(show).not.toHaveBeenCalled();
});

it("returns refusals without changing the displayed run or its tool selection", async () => {
	const show = vi.fn(async () => {});
	const onStarted = vi.fn();
	const failure = await replyToConversation(
		{
			daemon: {
				conversationReply: async () =>
					err({
						code: "refused",
						detail: "not completed",
					}),
			},
			shown: { dir: "/w", runId: "old", goal: "title" },
			current: () => undefined,
			show,
			onStarted,
			capabilities: [],
		},
		"draft",
	);
	expect(failure).toContain("not completed");
	expect(show).not.toHaveBeenCalled();
	expect(onStarted).not.toHaveBeenCalled();
});

it("refuses a send with no shown conversation before calling the required service", async () => {
	const conversationReply = vi.fn<MeteDaemonService["conversationReply"]>(
		async () => ok({ runId: "next" }),
	);
	expect(
		await replyToConversation(
			{
				daemon: { conversationReply },
				shown: undefined,
				current: () => undefined,
				show: async () => {},
				onStarted: () => {},
				capabilities: undefined,
			},
			"hello",
		),
	).toBe("Open a conversation first.");
	expect(conversationReply).not.toHaveBeenCalled();
});
