import { err, ok } from "@mete/contracts";
import { expect, it } from "vitest";
import type { Send } from "../src/infrastructure/settings-requests.js";
import { threadContextRequests } from "../src/infrastructure/thread-context-requests.js";

const id = "00000000-0000-4000-8000-000000000001";
const snapshot = {
	path: "a.ts",
	content: "[masked]",
	modified: true,
	sha256: "a".repeat(64),
};

it("validates all context boundaries and preserves the exact masked preview", async () => {
	const calls: string[] = [];
	let answer: unknown = snapshot;
	const send: Send = async (_dir, method, _input, parse) => {
		calls.push(method);
		const parsed = parse(answer);
		return parsed.success
			? ok(parsed.data)
			: err({ code: "protocol", detail: "" });
	};
	const port = threadContextRequests(send);
	expect(
		await port.threadContextPrepare("/w", {
			path: "a.ts",
			content: "secret",
			modified: true,
		}),
	).toEqual(ok(snapshot));
	answer = { conversationId: id, runId: id };
	expect(
		(
			await port.threadContextStart("/w", {
				requestId: id,
				goal: "hi",
				attachments: [snapshot],
			})
		).ok,
	).toBe(true);
	expect(
		(
			await port.threadContextReply("/w", {
				conversationId: id,
				expectedRunId: id,
				requestId: id,
				message: "next",
				attachments: [snapshot],
			})
		).ok,
	).toBe(true);
	answer = { runId: id, attachments: [snapshot] };
	expect(await port.threadContextRead("/w", { runId: id })).toEqual(ok(answer));
	answer = { runId: id, attachments: [], extra: true };
	expect((await port.threadContextRead("/w", { runId: id })).ok).toBe(false);
	expect(
		(
			await port.threadContextPrepare("/w", {
				path: "a.ts",
				content: "",
				modified: false,
			})
		).ok,
	).toBe(false);
	expect(calls).toEqual([
		"mete/thread.context.prepare",
		"mete/thread.context.start",
		"mete/thread.context.reply",
		"mete/thread.context.read",
		"mete/thread.context.read",
	]);
});

it("does not downgrade a missing context port to an ordinary send", async () => {
	const calls: string[] = [];
	const port = threadContextRequests(async (_dir, method) => {
		calls.push(method);
		return err({ code: "refused", detail: "unavailable" });
	});
	expect(
		await port.threadContextStart("/w", {
			requestId: id,
			goal: "hi",
			attachments: [snapshot],
		}),
	).toEqual(err({ code: "refused", detail: "unavailable" }));
	expect(calls).toEqual(["mete/thread.context.start"]);
});
