import { randomUUID } from "node:crypto";
import { ok, parseTemplate } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { initialTransition } from "xstate";
import { runMachine } from "../../src/domain/run-machine.js";
import { applyTask, teamOf } from "../../src/domain/team.js";
import {
	reportSha256,
	withVerification,
} from "../../src/domain/verification.js";
import { engineHarness, reply, slow } from "../helpers/engine.js";
import { verificationHarness } from "../helpers/verification.js";

const deferred = () => {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
};
const interruptedFixture = (reason: "user" | "quota" = "user") => {
	const h = engineHarness({ scripts: [reply("report")] });
	const parsed = parseTemplate({
		apiVersion: "mete/v2",
		kind: "TeamTemplate",
		metadata: { id: "crash", name: "Crash", version: "1.0.0" },
		pattern: "single",
		roles: [
			{
				id: "dev",
				name: "Dev",
				goal: "Build",
				tier: "coder",
				capabilities: [],
			},
		],
		tasks: [
			{
				id: "build",
				role: "dev",
				title: "Build",
				verify: [{ run: "check", optional: true }],
			},
		],
	});
	if (!parsed.ok) throw new Error("bad fixture");
	const team = applyTask(teamOf(parsed.value), "build", {
		type: "START",
		agentId: randomUUID(),
	}).team;
	const checked = withVerification(team, "build", {
		evaluationId: randomUUID(),
		attemptId: team.tasks.build?.id ?? "",
		attemptNumber: 1,
		startedAt: new Date(0).toISOString(),
		reportSha256: reportSha256("report"),
		gates: [
			{
				index: 0,
				gate: "check",
				optional: true,
				details: "",
				status: "running",
			},
		],
	});
	const [initial] = initialTransition(runMachine, {
		goal: "crash",
		priority: 1,
		messages: [],
	});
	const runId = randomUUID();
	h.store.save(
		{
			id: runId,
			workspaceId: randomUUID(),
			autonomyLevel: 2,
			budget: { cloudRequests: 20, maxHours: 1 },
			createdAt: new Date(0).toISOString(),
		},
		runMachine.resolveState({
			value: "paused",
			context: {
				...initial.context,
				team: checked,
				task: "build",
				pause: {
					reason,
					...(reason === "quota"
						? { resumesAt: "2026-11-09T00:00:00.000Z" }
						: {}),
				},
			},
		}),
	);
	return { ...h, runId };
};

describe("durable verification lifecycle", () => {
	for (const action of ["pause", "cancel"] as const)
		it(`settles ${action} without dispatching the next gate or changing terminal evidence late`, async () => {
			const waiting = deferred();
			let calls = 0;
			const h = await verificationHarness("[{ run: first }, { run: second }]", {
				scripts: [reply("report")],
				tools: [
					[
						"shell.exec@1",
						async () => {
							calls++;
							await waiting.promise;
							return ok({
								exitCode: 0,
								stdout: "done",
								stderr: "",
								timedOut: false,
								os: "test",
								shell: "sh",
							});
						},
					],
				],
			});
			try {
				await vi.waitFor(() => expect(calls).toBe(1));
				expect(await h.read()).toMatchObject({
					value: {
						tasks: [
							{
								evaluations: [
									{
										gates: [
											{ index: 0, status: "running" },
											{ index: 1, status: "not_run", reason: "not_reached" },
										],
									},
								],
							},
						],
					},
				});
				await h.engine[action](h.runId);
				waiting.release();
				await vi.waitFor(async () =>
					expect(await h.read()).toMatchObject({
						value: {
							tasks: [
								{
									evaluations: [
										{
											gates: [
												action === "pause"
													? { index: 0, status: "passed" }
													: {
															index: 0,
															status: "not_run",
															reason: "interrupted",
														},
												{ index: 1, status: "not_run", reason: "not_reached" },
											],
										},
									],
								},
							],
						},
					}),
				);
				expect(calls).toBe(1);
				expect(
					h.events.some(
						(e) =>
							e.type === "task.status.changed" && e.payload.to === "submitted",
					),
				).toBe(false);
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: action === "pause" ? "paused" : "cancelled" }],
				});
				if (action === "cancel")
					expect(await h.engine.resume(h.runId)).toMatchObject({
						ok: false,
						error: { code: "invalid_state" },
					});
			} finally {
				waiting.release();
				await h.close();
			}
		});

	it("resumes the same evaluation after pause without replaying completed side-effect gates", async () => {
		const waiting = deferred();
		const commands: unknown[] = [];
		const h = await verificationHarness("[{ run: first }, { run: second }]", {
			scripts: [reply("report")],
			tools: [
				[
					"shell.exec@1",
					async (input) => {
						commands.push(input);
						if (commands.length === 1) await waiting.promise;
						return ok({
							exitCode: 0,
							stdout: "done",
							stderr: "",
							timedOut: false,
							os: "test",
							shell: "sh",
						});
					},
				],
			],
		});
		try {
			await vi.waitFor(() => expect(commands).toHaveLength(1));
			const before = await h.read();
			await h.engine.pause(h.runId);
			waiting.release();
			await vi.waitFor(async () =>
				expect(await h.read()).toMatchObject({
					value: {
						tasks: [
							{
								evaluations: [
									{
										gates: [
											{ index: 0, status: "passed" },
											{ index: 1, status: "not_run", reason: "not_reached" },
										],
									},
								],
							},
						],
					},
				}),
			);
			await h.engine.resume(h.runId);
			await vi.waitFor(() =>
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			const after = await h.read();
			expect(commands).toEqual([{ command: "first" }, { command: "second" }]);
			if (!before.ok || !after.ok) throw new Error("read failed");
			expect(after.value.tasks[0]?.evaluations[0]?.evaluationId).toBe(
				before.value.tasks[0]?.evaluations[0]?.evaluationId,
			);
		} finally {
			waiting.release();
			await h.close();
		}
	});

	it("keeps completed gates but seals uncertain cancellation rows before the terminal event", async () => {
		const waiting = deferred();
		let calls = 0;
		const h = await verificationHarness("[{ run: first }, { run: second }]", {
			scripts: [reply("report")],
			tools: [
				[
					"shell.exec@1",
					async () => {
						if (++calls === 2) await waiting.promise;
						return ok({
							exitCode: 0,
							stdout: "done",
							stderr: "",
							timedOut: false,
							os: "test",
							shell: "sh",
						});
					},
				],
			],
		});
		try {
			await vi.waitFor(() => expect(calls).toBe(2));
			await h.engine.cancel(h.runId);
			const sealed = await h.read();
			expect(sealed).toMatchObject({
				value: {
					tasks: [
						{
							evaluations: [
								{
									gates: [
										{ index: 0, status: "passed" },
										{ index: 1, status: "not_run", reason: "interrupted" },
									],
								},
							],
						},
					],
				},
			});
			const cancelled = h.events.findIndex(
				(event) => event.type === "run.cancelled",
			);
			expect(
				h.events
					.slice(cancelled + 1)
					.filter((event) => event.type.startsWith("verify.")),
			).toEqual([]);
			waiting.release();
			await h.stop();
			expect(await h.read()).toEqual(sealed);
			expect(
				h.events
					.slice(cancelled + 1)
					.filter((event) => event.type.startsWith("verify.")),
			).toEqual([]);
		} finally {
			waiting.release();
			await h.close();
		}
	});

	it("does not publish final verification notices after a cancellation from its update notification", async () => {
		const h = await verificationHarness(
			"[{ run: check }]",
			{
				scripts: [reply("report")],
				tools: [
					[
						"shell.exec@1",
						async () =>
							ok({
								exitCode: 0,
								stdout: "",
								stderr: "",
								timedOut: false,
								os: "test",
								shell: "sh",
							}),
					],
				],
			},
			(opened) => {
				opened.bus.subscribe("verify.updated", (event) => {
					const row =
						event.runId &&
						opened.store.load(event.runId)?.snapshot.context.team?.tasks.build
							?.verification?.gates[0];
					if (row && row.status === "passed" && event.runId)
						void opened.engine.cancel(event.runId);
				});
			},
		);
		try {
			await vi.waitFor(() =>
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: "cancelled" }],
				}),
			);
			const cancelled = h.events.findIndex(
				(event) => event.type === "run.cancelled",
			);
			expect(
				h.events
					.slice(cancelled + 1)
					.filter((event) => event.type.startsWith("verify.")),
			).toEqual([]);
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [{ evaluations: [{ gates: [{ status: "passed" }] }] }],
				},
			});
		} finally {
			await h.close();
		}
	});

	for (const reason of ["user", "quota"] as const)
		it(`recovers pending as interrupted, preserving ${reason} until explicit feedback`, async () => {
			const h = interruptedFixture(reason);
			try {
				h.recover();
				const read = await h.verification.read({ runId: h.runId });
				expect(read).toMatchObject({
					value: {
						tasks: [
							{
								evaluations: [
									{
										gates: [
											{
												status: "not_run",
												reason: "interrupted",
												optional: true,
											},
										],
									},
								],
							},
						],
					},
				});
				const pending = await h.tasks.pending({ runId: h.runId });
				if (!pending.ok || !pending.value.requests[0])
					throw new Error("missing verification block");
				const request = pending.value.requests[0];
				expect(request).toMatchObject({
					kind: "blocked",
					reason: "verification",
				});
				const identity = {
					runId: h.runId,
					taskId: request.taskId,
					requestId: request.requestId,
				};
				expect(
					await h.tasks.answer({ ...identity, decision: "approve" }),
				).toMatchObject({ ok: false });
				expect(
					await h.tasks.answer({
						...identity,
						decision: "answer",
						feedback: "Inspected effects; retry.",
					}),
				).toEqual(ok(undefined));
				expect(h.store.load(h.runId)?.snapshot.context.pause?.reason).toBe(
					reason,
				);
				expect(h.requests).toEqual([]);
				expect(
					h.store.load(h.runId)?.snapshot.context.team?.tasks.build
						?.verification,
				).toBeUndefined();
			} finally {
				await h.stop();
				h.db.close();
			}
		});

	it("ordinary resume cannot replay an uncertain optional command", async () => {
		const h = interruptedFixture();
		let calls = 0;
		h.registry.provide("shell.exec@1", {
			id: "shell",
			trust: "core",
			features: [],
			impl: {
				run: async () => {
					calls++;
					return ok({
						exitCode: 0,
						stdout: "",
						stderr: "",
						timedOut: false,
						os: "test",
						shell: "sh",
					});
				},
			},
		});
		try {
			h.recover();
			await h.engine.resume(h.runId);
			await vi.waitFor(() =>
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: "paused" }],
				}),
			);
			expect(calls).toBe(0);
			expect(h.requests).toEqual([]);
			expect(await h.verification.read({ runId: h.runId })).toMatchObject({
				value: {
					tasks: [{ evaluations: [{ gates: [{ reason: "interrupted" }] }] }],
				},
			});
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("reads the same final evidence after event loss and a restart without starting work", async () => {
		const h = await verificationHarness(
			"[{ capability: gameengine.test@1, optional: true }]",
		);
		let reader: ReturnType<typeof engineHarness> | undefined;
		try {
			await vi.waitFor(() =>
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			const evidence = await h.read();
			h.events.splice(0);
			reader = engineHarness({ scripts: [slow], db: h.db });
			expect(await reader.verification.read({ runId: h.runId })).toEqual(
				evidence,
			);
			expect(reader.requests).toEqual([]);
			expect(reader.events).toEqual([]);
		} finally {
			await reader?.stop();
			await h.close();
		}
	});

	it("does not let an old pending outcome replace a newer retry evaluation", async () => {
		const waiting = deferred();
		let calls = 0;
		const first = await verificationHarness("[{ run: check }]", {
			scripts: [reply("report")],
			tools: [
				[
					"shell.exec@1",
					async () => {
						calls++;
						await waiting.promise;
						return ok({
							exitCode: 0,
							stdout: "old result",
							stderr: "",
							timedOut: false,
							os: "test",
							shell: "sh",
						});
					},
				],
			],
		});
		let later: ReturnType<typeof engineHarness> | undefined;
		try {
			await vi.waitFor(() => expect(calls).toBe(1));
			await first.engine.pause(first.runId);
			later = engineHarness({
				db: first.db,
				scripts: [reply("new report")],
				tools: [
					[
						"shell.exec@1",
						async () =>
							ok({
								exitCode: 0,
								stdout: "new result",
								stderr: "",
								timedOut: false,
								os: "test",
								shell: "sh",
							}),
					],
				],
			});
			later.recover();
			const pending = await later.tasks.pending({ runId: first.runId });
			const request = pending.ok ? pending.value.requests[0] : undefined;
			if (!request) throw new Error("no recovered wait");
			await later.tasks.answer({
				runId: first.runId,
				taskId: request.taskId,
				requestId: request.requestId,
				decision: "answer",
				feedback: "Inspected effects; retry.",
			});
			await later.engine.resume(first.runId);
			const reader = later;
			await vi.waitFor(() =>
				expect(reader.engine.status(first.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			const result = await later.verification.read({ runId: first.runId });
			waiting.release();
			await first.stop();
			expect(await later.verification.read({ runId: first.runId })).toEqual(
				result,
			);
			expect(JSON.stringify(result)).toContain("new result");
			expect(JSON.stringify(result)).not.toContain("old result");
		} finally {
			waiting.release();
			await later?.stop();
			await first.close();
		}
	});

	it("refuses single-agent reads and does not synthesize legacy evaluations", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		try {
			const started = await h.engine.start({
				goal: "single",
				templateId: null,
			});
			if (!started.ok) throw new Error("single start failed");
			expect(
				await h.verification.read({ runId: started.value.runId }),
			).toMatchObject({ ok: false, error: { code: "not_supported" } });
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
