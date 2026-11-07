import { err, ok } from "@mete/contracts";
import { expect, it } from "vitest";
import { conversationRequests } from "../src/infrastructure/conversation-requests.js";
import type { Send } from "../src/infrastructure/settings-requests.js";

it("validates the explicit inputs and parses answers through the conversation schema", async () => {
	const calls: { method: string; params: object }[] = [];
	let answer: unknown = { runId: "next" };
	const send: Send = async (_dir, method, params, parse) => {
		calls.push({ method, params });
		const parsed = parse(answer);
		return parsed.success
			? ok(parsed.data)
			: err({ code: "protocol", detail: parsed.error.message });
	};
	const requests = conversationRequests(send);
	expect(await requests.conversationStart("/w", { goal: " hello " })).toEqual(
		ok({ runId: "next" }),
	);
	expect(calls[0]).toEqual({
		method: "mete/conversation.start",
		params: { goal: "hello", capabilities: [] },
	});
	await requests.conversationReply("/w", { runId: "old", message: "next" });
	expect(calls[1]?.params).toEqual({ runId: "old", message: "next" });
	const invalid = await requests.conversationStart("/w", {
		goal: "hi",
		capabilities: ["web.fetch@1", "web.fetch@1"],
	});
	expect(invalid).toMatchObject({ ok: false, error: { code: "protocol" } });
	expect(calls).toHaveLength(2);
	answer = { runId: "" };
	expect(await requests.conversationStart("/w", { goal: "hi" })).toMatchObject({
		ok: false,
		error: { code: "protocol" },
	});
});
