import { PassThrough } from "node:stream";
import {
	DAEMON_METHODS,
	err,
	ok,
	type TaskVerificationAdapter,
	type TaskVerificationResult,
	type TeamEngineAdapter,
} from "@mete/contracts";
import { createCapabilityRegistry, createEventBus } from "@mete/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import type { App } from "../src/infrastructure/app.js";
import { recordingIo } from "./helpers.js";

const runId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const attemptId = crypto.randomUUID();
const earlierAttemptId = crypto.randomUUID();
const task = {
	taskId,
	templateTaskId: "build",
	title: "Build",
	currentAttemptId: attemptId,
};
const gate = { index: 0, gate: "shell.exec@1", optional: false, details: "" };
const evidence: TaskVerificationResult = {
	mode: "strict",
	tasks: [
		{
			...task,
			evaluations: [
				{
					evaluationId: crypto.randomUUID(),
					attemptId: earlierAttemptId,
					attemptNumber: 1,
					reportSha256: "a".repeat(64),
					startedAt: "2026-11-08T10:00:00.000Z",
					gates: [{ ...gate, status: "failed", details: "exit 1" }],
				},
				{
					evaluationId: crypto.randomUUID(),
					attemptId,
					attemptNumber: 2,
					reportSha256: "b".repeat(64),
					startedAt: "2026-11-08T10:01:00.000Z",
					gates: [
						{ ...gate, status: "passed" },
						{ ...gate, index: 1, status: "running" },
						{
							...gate,
							index: 2,
							optional: true,
							status: "not_run",
							reason: "capability_missing",
						},
					],
				},
			],
		},
	],
};
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const served = (options: { engine?: boolean; support?: boolean } = {}) => {
	const registry = createCapabilityRegistry(() => []);
	const engine: TeamEngineAdapter = {
		start: async () => ok({ runId }),
		pause: async () => ok(undefined),
		resume: async () => ok(undefined),
		cancel: async () => ok(undefined),
		approve: async () => ok(undefined),
		status: () => ok([]),
	};
	if (options.engine !== false)
		registry.provide("team.engine@3", {
			id: "test-engine",
			trust: "core",
			features: [],
			impl: engine,
		});
	const read = vi.fn<TaskVerificationAdapter["read"]>(async () => ok(evidence));
	if (options.support !== false)
		registry.provide<TaskVerificationAdapter>("task.verification@1", {
			id: "test-verification",
			trust: "core",
			features: [],
			impl: { read },
		});
	const app = {
		registry,
		events: createEventBus((error) => {
			throw error;
		}),
		modules: [],
		inactive: [],
	} as unknown as App;
	const input = new PassThrough();
	const output = new PassThrough();
	const serving = daemonCommand(app, recordingIo().io, ".", { input, output });
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
	};
	const request = (params: unknown = { runId }) =>
		client.sendRequest(DAEMON_METHODS.taskVerification, params);
	return { request, read };
};

describe("daemon persisted verification (ADR-187)", () => {
	it("serves the protocol34 route with exact attempt, position and state evidence", async () => {
		const t = served();
		expect(await t.request()).toEqual(evidence);
		expect(t.read).toHaveBeenCalledWith({ runId });
	});

	it("keeps legacy mode and unknown historical outcomes without synthesizing gates", async () => {
		const t = served();
		const legacy: TaskVerificationResult = {
			mode: "legacy",
			tasks: [{ ...task, evaluations: [] }],
		};
		t.read.mockResolvedValue(ok(legacy));
		expect(await t.request()).toEqual(legacy);
	});

	it("rejects malformed and extended requests before dispatch", async () => {
		const t = served();
		for (const params of [
			{},
			{ runId: "" },
			{ runId: "nope" },
			{ runId, extra: true },
		])
			await expect(t.request(params)).rejects.toMatchObject({ code: -32602 });
		expect(t.read).not.toHaveBeenCalled();
	});

	it("retains truthful engine readiness without invoking a model", async () => {
		const t = served({ engine: false });
		await expect(t.request()).rejects.toMatchObject({
			data: { code: "not_ready", reasons: ["core-engine is not active."] },
		});
		await expect(t.request({ runId, extra: true })).rejects.toMatchObject({
			code: -32602,
		});
		expect(t.read).not.toHaveBeenCalled();
	});

	it("reports a missing verification port instead of an empty successful result", async () => {
		const t = served({ support: false });
		await expect(t.request()).rejects.toMatchObject({
			data: { code: "not_supported" },
		});
	});

	it("preserves missing-run and failed-read refusal codes", async () => {
		const t = served();
		for (const code of ["not_found", "failed"] as const) {
			t.read.mockResolvedValue(err({ code, message: "cannot read evidence" }));
			await expect(t.request()).rejects.toMatchObject({ data: { code } });
		}
	});

	it("refuses invalid adapter output at every boundary depth", async () => {
		const t = served();
		const evaluation = evidence.tasks[0]?.evaluations[0];
		const snapshot = (row: unknown) => ({
			mode: "strict",
			tasks: [{ ...task, evaluations: [row] }],
		});
		const outputs: unknown[] = [
			{ ...evidence, extra: true },
			{ ...evidence, mode: "legacy" },
			{ mode: "strict", tasks: [{ ...task, evaluations: [], extra: true }] },
			snapshot({ ...evaluation, extra: true }),
			snapshot({
				...evaluation,
				gates: [{ ...gate, status: "not_run" }],
			}),
			snapshot({
				...evaluation,
				gates: [{ ...gate, status: "passed", reason: "denied" }],
			}),
			snapshot({
				...evaluation,
				gates: [{ ...gate, index: 1, status: "passed" }],
			}),
		];
		for (const output of outputs) {
			// Deliberately faulty adapter at the external capability boundary.
			t.read.mockResolvedValue(
				ok(output) as Awaited<ReturnType<TaskVerificationAdapter["read"]>>,
			);
			await expect(t.request()).rejects.toMatchObject({ code: -32603 });
		}
	});

	it("answers thrown adapter bugs explicitly rather than returning empty evidence", async () => {
		const t = served();
		t.read.mockRejectedValue(new Error("adapter bug"));
		await expect(t.request()).rejects.toMatchObject({
			code: -32603,
			message: "internal error",
		});
	});
});
