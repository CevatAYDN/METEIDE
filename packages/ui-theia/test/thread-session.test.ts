import type { Result } from "@mete/contracts";
import {
	err,
	ok,
	type ThreadReadResult,
	type ThreadStarted,
} from "@mete/contracts";
import { expect, it, vi } from "vitest";
import type { Shown } from "../src/application/board-session.js";
import { createSendIntent } from "../src/application/send-intent.js";
import { createThreadSession } from "../src/application/thread-session.js";
import type {
	DaemonFailure,
	MeteDaemonService,
} from "../src/domain/status-service.js";

const old = "00000000-0000-4000-8000-000000000001";
const next = "00000000-0000-4000-8000-000000000002";
const predecessor: Shown = { dir: "/w", runId: old, goal: "title" };
const head = {
	id: old,
	workspaceId: old,
	templateId: null,
	goal: "title",
	status: "completed",
	autonomyLevel: 2,
	budget: { cloudRequests: 10, maxHours: 1 },
	createdAt: "2026-11-07T10:00:00.000Z",
} as const;
const history: ThreadReadResult = {
	conversation: {
		id: old,
		title: "title",
		head,
		createdAt: head.createdAt,
		updatedAt: head.createdAt,
		turnCount: 1,
	},
	turns: [head],
};

const setup = () => {
	let shown: Shown | undefined = predecessor;
	let read: ThreadReadResult | undefined = history;
	const threadReply = vi.fn<MeteDaemonService["threadReply"]>(async () =>
		ok({ conversationId: old, runId: next }),
	);
	const show = vi.fn(async () => {});
	const session = createThreadSession({
		daemon: () => ({ threadReply }),
		shown: () => shown,
		thread: () => read,
		show,
		onChange: () => {},
	});
	return {
		session,
		threadReply,
		show,
		select: (value: Shown | undefined) => {
			shown = value;
		},
		read: (value: ThreadReadResult | undefined) => {
			read = value;
		},
	};
};

it("retains identical retry identity, changes it for edits, and inherits unknown tools", async () => {
	const t = setup();
	t.threadReply.mockResolvedValue(
		err({ code: "stopped", detail: "lost receipt" }),
	);
	await t.session.reply(" hello ");
	await t.session.reply("hello");
	const first = t.threadReply.mock.calls[0]?.[1];
	expect(t.threadReply.mock.calls[1]?.[1]).toEqual(first);
	expect(first).toMatchObject({
		conversationId: old,
		expectedRunId: old,
		message: "hello",
	});
	expect(first).not.toHaveProperty("capabilities");
	t.session.draftChanged();
	await t.session.reply("hello");
	expect(t.threadReply.mock.calls[2]?.[1].requestId).not.toBe(first?.requestId);
	t.session.tools()?.props.onChange([]);
	await t.session.reply("hello");
	expect(t.threadReply.mock.calls[3]?.[1].capabilities).toEqual([]);
});

it("locks duplicate sends and ignores late navigation after selection changes", async () => {
	const t = setup();
	let resolve!: (value: Result<ThreadStarted, DaemonFailure>) => void;
	t.threadReply.mockImplementation(
		() =>
			new Promise((yes) => {
				resolve = yes;
			}),
	);
	t.session.remember(predecessor, ["mcp.tools@1"]);
	const stale = t.session.tools();
	const sent = t.session.reply("hello");
	stale?.props.onChange([]);
	expect(await t.session.reply("hello")).toContain("already");
	t.select({ ...predecessor, dir: "/other" });
	resolve(ok({ conversationId: old, runId: next }));
	await sent;
	expect(t.show).not.toHaveBeenCalled();
	t.select({ ...predecessor, runId: next });
	expect(t.session.tools()?.props.capabilities).toEqual(["mcp.tools@1"]);
});

it("replays the complete uncertain receipt after refresh advances the head, but never a changed intent", async () => {
	const t = setup();
	t.session.remember(predecessor, ["mcp.tools@1"]);
	t.threadReply.mockResolvedValueOnce(
		err({ code: "stopped", detail: "response lost" }),
	);
	await t.session.reply("hello");
	const submitted = t.threadReply.mock.calls[0]?.[1];
	t.read({
		...history,
		conversation: { ...history.conversation, head: { ...head, id: next } },
	});
	expect(t.session.canRetry()).toBe(true);
	await t.session.reply("hello");
	expect(t.threadReply.mock.calls[1]?.[1]).toEqual(submitted);
	expect(t.show).toHaveBeenCalledWith("/w", next, "title");
	expect(t.session.canRetry()).toBe(false);
	expect(await t.session.reply("new intent")).toContain("latest");
	expect(t.threadReply).toHaveBeenCalledTimes(2);
});

it("cancels uncertain replay on draft/tools edits even after the retained head changes", async () => {
	for (const edit of ["draft", "tools", "changed message"]) {
		const t = setup();
		t.threadReply.mockResolvedValue(
			err({ code: "stopped", detail: "response lost" }),
		);
		await t.session.reply("hello");
		t.read({
			...history,
			conversation: { ...history.conversation, head: { ...head, id: next } },
		});
		if (edit === "draft") t.session.draftChanged();
		if (edit === "tools") t.session.tools()?.props.onChange([]);
		expect(
			await t.session.reply(edit === "changed message" ? "edited" : "hello"),
		).toContain("latest");
		expect(t.session.canRetry()).toBe(false);
		expect(t.threadReply).toHaveBeenCalledTimes(1);
	}
});

it("never sends from unresolved history or an older run, or a non-completed head", async () => {
	const t = setup();
	t.read(undefined);
	expect(await t.session.reply("hi")).toBeTruthy();
	t.read({
		...history,
		conversation: { ...history.conversation, head: { ...head, id: next } },
	});
	expect(await t.session.reply("hi")).toContain("latest");
	t.read({
		...history,
		conversation: {
			...history.conversation,
			head: { ...head, status: "failed" },
		},
	});
	expect(await t.session.reply("hi")).toBeTruthy();
	expect(t.threadReply).not.toHaveBeenCalled();
});

it("uses fresh UUIDs for new start intent payloads and after success", () => {
	const intents = createSendIntent();
	const first = intents.for("/w", { goal: "hello" });
	expect(intents.for("/w", { goal: "hello" })).toBe(first);
	expect(intents.for("/elsewhere", { goal: "hello" })).not.toBe(first);
	expect(intents.for("/w", { goal: "edited" })).not.toBe(first);
	intents.clear("/w");
	expect(intents.for("/w", { goal: "hello" })).not.toBe(first);
});
