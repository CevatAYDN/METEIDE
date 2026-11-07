import { err, ok } from "@mete/contracts";
import { expect, it } from "vitest";
import type { Send } from "../src/infrastructure/settings-requests.js";
import { threadRequests } from "../src/infrastructure/thread-requests.js";

const id = "00000000-0000-4000-8000-000000000001";

it("validates every thread boundary and never falls back to a legacy send", async () => {
	const calls: { method: string; params: object }[] = [];
	let answer: unknown = { conversationId: id, runId: id };
	const send: Send = async (_dir, method, params, parse) => {
		calls.push({ method, params });
		const parsed = parse(answer);
		return parsed.success
			? ok(parsed.data)
			: err({ code: "protocol", detail: parsed.error.message });
	};
	const requests = threadRequests(send);
	expect(
		await requests.threadStart("/w", { goal: " hi ", requestId: id }),
	).toEqual(ok(answer));
	expect(calls[0]).toEqual({
		method: "mete/thread.start",
		params: { goal: "hi", capabilities: [], requestId: id },
	});
	await requests.threadReply("/w", {
		conversationId: id,
		expectedRunId: id,
		requestId: id,
		message: " next ",
	});
	expect(calls[1]?.method).toBe("mete/thread.reply");
	answer = { conversations: [] };
	expect(await requests.threadList("/w", {})).toEqual(ok(answer));
	expect(calls[2]).toEqual({
		method: "mete/thread.list",
		params: { query: "", limit: 50 },
	});
	answer = {};
	expect(await requests.threadRead("/w", { runId: id })).toMatchObject({
		ok: false,
		error: { code: "protocol" },
	});
	expect(calls[3]?.method).toBe("mete/thread.read");
	for (const result of [
		await requests.threadStart("/w", { goal: "hi", requestId: "invalid" }),
		await requests.threadReply("/w", {
			conversationId: id,
			expectedRunId: id,
			requestId: id,
			message: "",
		}),
		await requests.threadList("/w", { limit: 101 }),
		await requests.threadRead("/w", { runId: "" }),
	])
		expect(result).toMatchObject({ ok: false, error: { code: "protocol" } });
	expect(calls).toHaveLength(4);
});

it("preserves transport failures without dispatching another method", async () => {
	const requests = threadRequests(async () =>
		err({ code: "stopped", detail: "exit" }),
	);
	expect(
		await requests.threadStart("/w", { goal: "hi", requestId: id }),
	).toEqual(err({ code: "stopped", detail: "exit" }));
});
