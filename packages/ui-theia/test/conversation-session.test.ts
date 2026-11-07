import { err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import type { Shown } from "../src/application/board-session.js";
import { createConversationSession } from "../src/application/conversation-session.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

type Reply = Awaited<ReturnType<MeteDaemonService["conversationReply"]>>;
const predecessor = { dir: "/w", runId: "old", goal: "title" };
const deferred = () => {
	let resolve!: (result: Reply) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<Reply>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
const setup = (promise: Promise<Reply>) => {
	let shown: Shown | undefined = predecessor;
	const conversationReply = vi.fn<MeteDaemonService["conversationReply"]>(
		() => promise,
	);
	const onChange = vi.fn();
	const show = vi.fn(async () => {});
	const session = createConversationSession({
		daemon: () => ({ conversationReply }),
		shown: () => shown,
		show,
		onChange,
	});
	return {
		session,
		conversationReply,
		onChange,
		show,
		select: (target: Shown | undefined) => {
			shown = target;
		},
	};
};

it("locks tools before dispatch, rejects stale edits and carries the submitted selection to the successor", async () => {
	const request = deferred();
	const { session, onChange, conversationReply, select } = setup(
		request.promise,
	);
	session.remember(predecessor, ["mcp.tools@1"]);
	const stale = session.tools();
	const reply = session.reply("hello");
	expect(onChange).toHaveBeenCalledTimes(1);
	expect(session.tools()?.props.disabled).toBe(true);
	stale?.props.onChange(["web.search@1"]);
	session.tools()?.props.onChange([]);
	request.resolve(ok({ runId: "next" }));
	await reply;
	expect(conversationReply).toHaveBeenCalledExactlyOnceWith("/w", {
		runId: "old",
		message: "hello",
		capabilities: ["mcp.tools@1"],
	});
	expect(session.tools()?.props.capabilities).toEqual(["mcp.tools@1"]);
	expect(session.tools()?.props.disabled).toBe(false);
	expect(onChange).toHaveBeenCalledTimes(2);
	select({ ...predecessor, runId: "next" });
	expect(session.tools()?.props.capabilities).toEqual(["mcp.tools@1"]);
});

it("rejects a duplicate submission after navigating away and back without unlocking the first request", async () => {
	const request = deferred();
	const { session, select, conversationReply } = setup(request.promise);
	const first = session.reply("first");
	select({ ...predecessor, runId: "other" });
	select({ ...predecessor });
	expect(await session.reply("duplicate")).toContain("already");
	expect(conversationReply).toHaveBeenCalledOnce();
	expect(session.tools()?.props.disabled).toBe(true);
	request.resolve(ok({ runId: "next" }));
	await first;
	expect(session.tools()?.props.disabled).toBe(false);
});

it("locks an unknown selection against stale replacement while replies still omit the override", async () => {
	const request = deferred();
	const { session, conversationReply } = setup(request.promise);
	const stale = session.tools();
	const reply = session.reply("hello");
	stale?.props.onChange([]);
	request.resolve(ok({ runId: "next" }));
	await reply;
	expect(conversationReply).toHaveBeenCalledExactlyOnceWith("/w", {
		runId: "old",
		message: "hello",
	});
	expect(session.tools()?.props.capabilities).toBeUndefined();
	session.tools()?.props.onChange([]);
	expect(session.tools()?.props.capabilities).toEqual([]);
});

it("scopes pending locks by workspace and run and leaves late successes off another conversation", async () => {
	const request = deferred();
	const { session, select, show } = setup(request.promise);
	session.remember(predecessor, ["mcp.tools@1"]);
	const reply = session.reply("hello");
	for (const target of [
		{ ...predecessor, runId: "other" },
		{ ...predecessor, dir: "/other" },
	]) {
		select(target);
		expect(session.tools()?.props.disabled).toBe(false);
		session.tools()?.props.onChange([]);
		expect(session.tools()?.props.capabilities).toEqual([]);
		select({ ...predecessor });
		expect(session.tools()?.props.disabled).toBe(true);
	}
	select({ ...predecessor, dir: "/other" });
	request.resolve(ok({ runId: "next" }));
	await reply;
	expect(show).not.toHaveBeenCalled();
	expect(session.tools()?.props.capabilities).toEqual([]);
	select({ ...predecessor, runId: "next" });
	expect(session.tools()?.props.capabilities).toEqual(["mcp.tools@1"]);
});

it("releases the lock on refusal or rejection without losing the selection", async () => {
	for (const fails of ["refused", "throws"]) {
		const request = deferred();
		const { session, onChange } = setup(request.promise);
		session.remember(predecessor, ["mcp.tools@1"]);
		const reply = session.reply("hello");
		if (fails === "refused") {
			request.resolve(err({ code: "refused", detail: "not completed" }));
			expect(await reply).toContain("not completed");
		} else {
			const rejected = expect(reply).rejects.toThrow("transport stopped");
			request.reject(new Error("transport stopped"));
			await rejected;
		}
		expect(session.tools()?.props.disabled).toBe(false);
		expect(session.tools()?.props.capabilities).toEqual(["mcp.tools@1"]);
		expect(onChange).toHaveBeenCalledTimes(2);
		session.tools()?.props.onChange([]);
		expect(session.tools()?.props.capabilities).toEqual([]);
	}
});
