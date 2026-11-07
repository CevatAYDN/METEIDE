import { PassThrough } from "node:stream";
import {
	DAEMON_METHODS,
	err,
	ok,
	type TaskControlAdapter,
	type TaskControlAnswer,
	type TaskPending,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import { createApp, engineOf } from "../src/infrastructure/app.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

const identity = {
	runId: crypto.randomUUID(),
	taskId: crypto.randomUUID(),
	requestId: crypto.randomUUID(),
};
const wait: TaskPending = {
	...identity,
	templateTaskId: "write",
	title: "Write",
	kind: "approval",
};
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const served = async (support = true) => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	const made = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
		secrets: memorySecrets(),
		providers: [],
	});
	if (!made.ok) throw new Error("app");
	const app = made.value;
	const pending = vi.fn<TaskControlAdapter["pending"]>(async () =>
		ok({ requests: [wait] }),
	);
	const answer = vi.fn<TaskControlAdapter["answer"]>(async () => ok(undefined));
	if (support)
		app.registry.provide<TaskControlAdapter>("task.control@1", {
			id: "test-task-control",
			trust: "core",
			features: [],
			impl: { pending, answer },
		});
	const input = new PassThrough();
	const output = new PassThrough();
	const serving = daemonCommand(app, recordingIo().io, repo.workspaceDir, {
		input,
		output,
	});
	const client = createMessageConnection(
		new StreamMessageReader(output),
		new StreamMessageWriter(input),
	);
	client.listen();
	close = async () => {
		input.end();
		await serving;
		client.dispose();
		output.destroy();
		await app.stop();
		await repo.close();
	};
	return { app, client, pending, answer };
};

describe("daemon task controls", () => {
	it("registers pending without requiring an engine and forwards exact answers", async () => {
		const t = await served();
		expect(engineOf(t.app).ok).toBe(false);
		expect(
			await t.client.sendRequest(DAEMON_METHODS.taskPending, {
				runId: identity.runId,
			}),
		).toEqual({ requests: [wait] });
		expect(t.pending).toHaveBeenCalledWith({ runId: identity.runId });
		const decisions: TaskControlAnswer[] = [
			{ ...identity, decision: "allow", scope: "once" },
			{ ...identity, decision: "allow", scope: "task" },
			{ ...identity, decision: "approve" },
			{ ...identity, decision: "revise", feedback: "revise it" },
			{ ...identity, decision: "answer", feedback: "use LF" },
			{ ...identity, decision: "retry" },
		];
		for (const input of decisions) {
			expect(
				await t.client.sendRequest(DAEMON_METHODS.taskAnswer, input),
			).toBeNull();
			expect(t.answer).toHaveBeenLastCalledWith(input);
		}
	});

	it("returns not_supported for missing ports, never fake success", async () => {
		const t = await served(false);
		for (const [method, params] of [
			[DAEMON_METHODS.taskPending, { runId: identity.runId }],
			[DAEMON_METHODS.taskAnswer, { ...identity, decision: "approve" }],
		] as const)
			await expect(t.client.sendRequest(method, params)).rejects.toMatchObject({
				data: { code: "not_supported" },
			});
	});

	it("rejects malformed and extended inputs before dispatch", async () => {
		const t = await served();
		for (const params of [{}, { runId: identity.runId, extra: true }])
			await expect(
				t.client.sendRequest(DAEMON_METHODS.taskPending, params),
			).rejects.toMatchObject({ code: -32602 });
		for (const params of [
			{ ...identity, decision: "approve", command: "replacement" },
			{ ...identity, decision: "allow", scope: "run" },
			{ ...identity, decision: "revise", feedback: " " },
			{ ...identity, requestId: "", decision: "retry" },
		])
			await expect(
				t.client.sendRequest(DAEMON_METHODS.taskAnswer, params),
			).rejects.toMatchObject({ code: -32602 });
		expect(t.pending).not.toHaveBeenCalled();
		expect(t.answer).not.toHaveBeenCalled();
	});

	it("preserves adapter refusal codes for pending and stale answers", async () => {
		const t = await served();
		t.pending.mockResolvedValue(err({ code: "not_found", message: "no run" }));
		t.answer.mockResolvedValue(
			err({
				code: "bad_input",
				message: "stale request",
			}),
		);
		await expect(
			t.client.sendRequest(DAEMON_METHODS.taskPending, {
				runId: identity.runId,
			}),
		).rejects.toMatchObject({ data: { code: "not_found" } });
		await expect(
			t.client.sendRequest(DAEMON_METHODS.taskAnswer, {
				...identity,
				decision: "approve",
			}),
		).rejects.toMatchObject({ data: { code: "bad_input" } });
	});

	it("strictly refuses invalid adapter outputs", async () => {
		const t = await served();
		t.pending.mockResolvedValue(ok({ requests: [], extra: true }));
		await expect(
			t.client.sendRequest(DAEMON_METHODS.taskPending, {
				runId: identity.runId,
			}),
		).rejects.toMatchObject({ code: -32603 });
		// A boundary fake simulates a faulty adapter returning a non-void success.
		t.answer.mockResolvedValue(
			ok({ unexpected: true }) as unknown as Awaited<
				ReturnType<TaskControlAdapter["answer"]>
			>,
		);
		await expect(
			t.client.sendRequest(DAEMON_METHODS.taskAnswer, {
				...identity,
				decision: "approve",
			}),
		).rejects.toMatchObject({ code: -32603 });
	});
});
