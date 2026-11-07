import { describe, expect, it } from "vitest";
import {
	ConversationThreadSchema,
	ThreadListInputSchema,
	ThreadListResultSchema,
	ThreadReadInputSchema,
	ThreadReadResultSchema,
} from "../../src/domain/conversation-thread.js";
import {
	DAEMON_METHODS,
	DAEMON_PROTOCOL_VERSION,
} from "../../src/domain/daemon.js";

const id = crypto.randomUUID();
const at = new Date(0).toISOString();
const head = {
	id,
	workspaceId: crypto.randomUUID(),
	templateId: null,
	goal: "hello",
	status: "completed",
	autonomyLevel: 2,
	budget: { cloudRequests: 10, maxHours: 1 },
	createdAt: at,
};
const conversation = {
	id,
	title: "hello",
	head,
	createdAt: at,
	updatedAt: at,
	turnCount: 1,
};

describe("conversation thread reads", () => {
	it("bounds pages and validates search cursors without interpreting query text", () => {
		expect(ThreadListInputSchema.parse({})).toEqual({ query: "", limit: 50 });
		expect(
			ThreadListInputSchema.parse({
				query: " %_hello' ",
				cursor: { id, updatedAt: at },
			}).query,
		).toBe("%_hello'");
		for (const bad of [
			{ limit: 0 },
			{ limit: 101 },
			{ limit: 1.5 },
			{ cursor: { id: "x", updatedAt: at } },
			{ cursor: { id, updatedAt: "yesterday" } },
			{ query: "", workspace: "other" },
		])
			expect(ThreadListInputSchema.safeParse(bad).success).toBe(false);
	});

	it("returns strict summaries and ordered retained run details", () => {
		expect(ConversationThreadSchema.parse(conversation)).toEqual(conversation);
		expect(ThreadReadInputSchema.parse({ runId: id })).toEqual({ runId: id });
		expect(
			ThreadReadResultSchema.parse({ conversation, turns: [head] }).turns,
		).toHaveLength(1);
		expect(
			ThreadListResultSchema.parse({
				conversations: [conversation],
				nextCursor: { id, updatedAt: at },
			}).conversations,
		).toHaveLength(1);
		expect(
			ConversationThreadSchema.safeParse({ ...conversation, turnCount: 0 })
				.success,
		).toBe(false);
		expect(
			ConversationThreadSchema.safeParse({
				...conversation,
				head: { ...head, templateId: "team" },
			}).success,
		).toBe(false);
		expect(
			ThreadReadResultSchema.safeParse({ conversation, turns: [] }).success,
		).toBe(false);
		for (const turns of [
			[{ ...head, templateId: "team" }],
			[{ ...head, id: crypto.randomUUID() }],
			[{ ...head, workspaceId: crypto.randomUUID() }],
			[head, head],
		])
			expect(
				ThreadReadResultSchema.safeParse({ conversation, turns }).success,
			).toBe(false);
		expect(
			ThreadListResultSchema.safeParse({ conversations: [], extra: true })
				.success,
		).toBe(false);
	});

	it("preserves protocol31 routes under protocol32 without renaming older entry points", () => {
		expect(DAEMON_PROTOCOL_VERSION).toBe(33);
		expect(DAEMON_METHODS).toMatchObject({
			threadStart: "mete/thread.start",
			threadReply: "mete/thread.reply",
			threadList: "mete/thread.list",
			threadRead: "mete/thread.read",
			conversationStart: "mete/conversation.start",
			conversationReply: "mete/conversation.reply",
		});
	});
});
