import { err, ok, type TaskControlAnswer } from "@mete/contracts";
import { expect, it } from "vitest";
import type { Send } from "../src/infrastructure/settings-requests.js";
import { taskControlRequests } from "../src/infrastructure/task-control-requests.js";

const identity = {
	runId: "11111111-1111-4111-8111-111111111111",
	taskId: "22222222-2222-4222-8222-222222222222",
	requestId: "33333333-3333-4333-8333-333333333333",
};

it("validates exact task requests before transport and strictly parses results", async () => {
	const calls: { method: string; params: object }[] = [];
	let result: unknown = { requests: [] };
	const send: Send = async (_dir, method, params, parse) => {
		calls.push({ method, params });
		const parsed = parse(result);
		return parsed.success
			? ok(parsed.data)
			: err({ code: "protocol", detail: parsed.error.message });
	};
	const client = taskControlRequests(send);
	expect(await client.taskPending("/w", identity.runId)).toEqual(
		ok({ requests: [] }),
	);
	expect(calls[0]).toEqual({
		method: "mete/task.pending",
		params: { runId: identity.runId },
	});
	const input: TaskControlAnswer = {
		...identity,
		decision: "allow",
		scope: "task",
	};
	result = null;
	expect(await client.taskAnswer("/w", input)).toEqual(ok(null));
	expect(calls[1]).toEqual({ method: "mete/task.answer", params: input });
	for (const bad of [
		{ ...input, command: "replacement" },
		{ ...input, scope: "always" },
	])
		expect(
			await client.taskAnswer("/w", bad as TaskControlAnswer),
		).toMatchObject({ ok: false, error: { code: "protocol" } });
	expect(await client.taskPending("/w", "")).toMatchObject({ ok: false });
	expect(calls).toHaveLength(2);
	result = { requests: [], extra: true };
	expect(await client.taskPending("/w", identity.runId)).toMatchObject({
		ok: false,
		error: { code: "protocol" },
	});
	expect(await client.taskAnswer("/w", input)).toMatchObject({
		ok: false,
		error: { code: "protocol" },
	});
});

it("keeps unavailable support as a failure", async () => {
	const failure = {
		code: "refused" as const,
		detail: "task.control@1 is not active",
	};
	const client = taskControlRequests(async () => err(failure));
	expect(await client.taskPending("/w", identity.runId)).toEqual(err(failure));
});
