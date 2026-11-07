import { err, ok, type ThreadReadResult } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import {
	contextScope,
	createContextDrafts,
} from "../src/application/context-drafts.js";
import { createThreadSession } from "../src/application/thread-session.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";
import { required } from "./required-fixture.js";

const id = "00000000-0000-4000-8000-000000000001";
const head = {
	id,
	workspaceId: id,
	templateId: null,
	goal: "title",
	status: "completed",
	autonomyLevel: 2,
	budget: { cloudRequests: 10, maxHours: 1 },
	createdAt: "2026-11-07T10:00:00.000Z",
} as const;
const setup = () => {
	const shown = { dir: "/w", runId: id, goal: "title" };
	let thread: ThreadReadResult = {
		conversation: {
			id,
			title: "title",
			head,
			createdAt: head.createdAt,
			updatedAt: head.createdAt,
			turnCount: 1,
		},
		turns: [head],
	};
	const drafts = createContextDrafts(() => {});
	const scope = contextScope("/w", id);
	drafts.select(scope);
	drafts.message(scope, "hello");
	const threadReply = vi.fn<MeteDaemonService["threadReply"]>(async () =>
		ok({ conversationId: id, runId: id }),
	);
	const threadContextReply = vi.fn<MeteDaemonService["threadContextReply"]>(
		async () => err({ code: "stopped", detail: "" }),
	);
	const recreate = () =>
		createThreadSession({
			drafts,
			daemon: () => ({ threadReply, threadContextReply }),
			shown: () => shown,
			thread: () => thread,
			show: async () => {},
			onChange: () => {},
		});
	const session = recreate();
	const add = () =>
		drafts.complete(required(drafts.prepare(scope)), {
			snapshot: {
				path: "a.ts",
				content: "masked",
				modified: true,
				sha256: "a".repeat(64),
			},
			sourcePath: "/w/a.ts",
		});
	return {
		session,
		drafts,
		scope,
		add,
		threadReply,
		threadContextReply,
		recreate,
		advance: () => {
			thread = {
				...thread,
				conversation: { ...thread.conversation, head: { ...head, id: "new" } },
			};
		},
	};
};

it("uses @1 without attachments and @2 with exact snapshots; retry ignores an advanced head", async () => {
	const t = setup();
	t.add();
	await t.session.reply("hello");
	expect(t.threadReply).not.toHaveBeenCalled();
	const receipt = t.threadContextReply.mock.calls[0]?.[1];
	expect(receipt?.attachments?.[0]).toMatchObject({
		content: "masked",
		modified: true,
	});
	t.advance();
	await t.session.retry();
	expect(t.threadContextReply.mock.calls[1]?.[1]).toEqual(receipt);
	expect(t.drafts.read(t.scope).message).toBe("hello");
	expect(t.drafts.read(t.scope).attachments).toHaveLength(1);
	const plain = setup();
	await plain.session.reply("hello");
	expect(plain.threadReply).toHaveBeenCalledTimes(1);
	expect(plain.threadContextReply).not.toHaveBeenCalled();
});

it("retains the exact uncertain context receipt when the panel is recreated after the head advances", async () => {
	const t = setup();
	t.add();
	await t.session.reply("hello");
	const receipt = t.threadContextReply.mock.calls[0]?.[1];
	t.advance();
	const reopened = t.recreate();
	expect(reopened.canRetry()).toBe(true);
	await reopened.retry();
	expect(t.threadContextReply.mock.calls[1]?.[1]).toEqual(receipt);
});

it("retains failed context and clears only a successfully sent scoped draft", async () => {
	const t = setup();
	t.add();
	t.threadContextReply.mockResolvedValueOnce(
		err({ code: "refused", detail: "" }),
	);
	expect(await t.session.reply("hello")).toBeTruthy();
	expect(t.drafts.read(t.scope).attachments).toHaveLength(1);
	t.threadContextReply.mockResolvedValue(ok({ conversationId: id, runId: id }));
	await t.session.reply("hello");
	expect(t.drafts.read(t.scope).attachments).toEqual([]);
	expect(t.drafts.read(t.scope).message).toBe("");
});

it("replays the exact uncertain reply after a fifth attachment is refused", async () => {
	const t = setup();
	for (let index = 0; index < 4; index++) t.add();
	await t.session.reply("hello");
	const receipt = t.threadContextReply.mock.calls[0]?.[1];
	expect(t.add()).toBe(false);
	t.advance();
	expect(t.session.canRetry()).toBe(true);
	await t.session.retry();
	expect(t.threadContextReply.mock.calls[1]?.[1]).toEqual(receipt);
	expect(t.drafts.read(t.scope).attachments).toHaveLength(4);
});

it("keeps an uncertain reply after an identical Update and retires it only when the snapshot changes", async () => {
	const t = setup();
	t.add();
	await t.session.reply("hello");
	const receipt = t.threadContextReply.mock.calls[0]?.[1];
	const original = required(t.drafts.read(t.scope).attachments[0]);
	t.drafts.complete(required(t.drafts.prepare(t.scope, original.id)), original);
	expect(t.session.canRetry()).toBe(true);
	await t.session.retry();
	expect(t.threadContextReply.mock.calls[1]?.[1]).toEqual(receipt);
	t.drafts.complete(required(t.drafts.prepare(t.scope, original.id)), {
		...original,
		snapshot: {
			...original.snapshot,
			content: "changed",
			sha256: "b".repeat(64),
		},
	});
	expect(t.session.canRetry()).toBe(false);
	await t.session.reply("hello");
	expect(t.threadContextReply.mock.calls[2]?.[1].requestId).not.toBe(
		receipt?.requestId,
	);
	expect(
		t.threadContextReply.mock.calls[2]?.[1].attachments?.[0]?.content,
	).toBe("changed");
});
