import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import {
	err,
	FsWriteInputSchema,
	ok,
	type ToolContext,
	type ToolIsolationAdapter,
	type VcsGitAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMachine } from "../../src/domain/run-machine.js";
import { engineHarness, reply, type Tool } from "../helpers/engine.js";
import {
	gatedStream,
	type SchedulerHarness,
	schedulerHarness,
	stateOf,
	untilRequests,
	untilStatus,
} from "../helpers/scheduler.js";

let held: SchedulerHarness | undefined;
let later: ReturnType<typeof engineHarness> | undefined;
const releases: (() => void)[] = [];
afterEach(async () => {
	for (const release of releases.splice(0)) release();
	await later?.stop();
	await held?.cleanup();
	later = undefined;
	held = undefined;
});
const gate = () => {
	let release = () => {};
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	releases.push(release);
	return { wait, release };
};
const writers = (source: string) =>
	source
		.replace("  - { id: c, role: first, title: Task C }\n", "")
		.replace(
			"  - { id: d, role: second, title: Task D, context: [a, b] }\n",
			"",
		)
		.replaceAll("capabilities: []", "capabilities: [fs.write@1]");
const toolResults = (h: SchedulerHarness, task: string) =>
	stateOf(h)?.context.team?.tasks[task]?.messages.filter(
		(m) => m.role === "tool",
	);

const assertRecorded = (h: SchedulerHarness, task: string) => {
	const entry = stateOf(h)?.context.team?.tasks[task];
	expect(entry?.session?.inFlight).toBe("call-0-fs_write");
	expect(entry?.session?.checkpointed).toBe(
		entry ? entry.messages.length - 1 : undefined,
	);
};

const isolatedHarness = async (
	options: {
		claim?: (cwd: string) => string | undefined;
		checkpoint?: (ctx: ToolContext) => Promise<string> | Promise<void>;
		descriptor?: boolean;
		mapped?: boolean;
		inspect?: (signal: AbortSignal) => Promise<void>;
		extraTask?: boolean;
		verify?: boolean;
	} = {},
) => {
	const models = ["a", "b"].map((id) =>
		gatedStream(
			reply("", [
				{ name: "fs_write", args: { path: `${id}.txt`, content: id } },
			]),
		),
	);
	for (const model of models) releases.push(model.release);
	const writes = [gate(), gate()];
	const called: ToolContext[] = [];
	const checkpoints: ToolContext[] = [];
	const created: string[] = [];
	const verified: ToolContext[] = [];
	let activeWrites = 0;
	let replaceWriter = (_run: Tool) => {};
	let replaceCheckpoint = (_adapter: VcsGitAdapter) => {};
	held = await schedulerHarness({
		scripts: [...models.map((m) => m.script), reply("done")],
		rewrite: (source) =>
			options.extraTask
				? writers(source).replace(
						"title: Task B }\n",
						"title: Task B }\n  - { id: c, role: first, title: Task C }\n",
					)
				: writers(source).replace(
						"title: Task A }",
						options.verify
							? "title: Task A, verify: [{ run: fixture-verify }] }"
							: "title: Task A }",
					),
		configure: (h) => {
			h.registry.provide("shell.exec@1", {
				id: "fixture-shell",
				trust: "core",
				features: [],
				impl: {
					run: async (_input: unknown, ctx: ToolContext) => {
						verified.push(ctx);
						return ok({
							exitCode: 0,
							stdout: "",
							stderr: "",
							timedOut: false,
							os: "test",
							shell: "fixture",
						});
					},
				},
			});
			const provideWriter = (run: Tool) =>
				h.registry.provide("fs.write@1", {
					id: options.mapped ? "fixture-mapping" : "fake-fs.write@1",
					trust: "core",
					features: [],
					impl: { run },
				});
			let writer = provideWriter(async (input, ctx) => {
				const parsed = FsWriteInputSchema.parse(input);
				if (!("content" in parsed)) throw new Error("unexpected delete");
				const h = held;
				if (!h) throw new Error("harness missing");
				const task = parsed.content;
				assertRecorded(h, task);
				expect(checkpoints.some((cp) => cp.cwd === ctx.cwd)).toBe(true);
				called.push(ctx);
				activeWrites++;
				await writes[task === "a" ? 0 : 1]?.wait;
				activeWrites--;
				return ok({ bytes: 1 });
			});
			replaceWriter = (run) => {
				writer.dispose();
				writer = provideWriter(run);
			};
			const vcs: VcsGitAdapter = {
				run: async (input, ctx) => {
					if (input.op === "worktree.create") {
						expect(activeWrites).toBe(0);
						created.push(input.taskId);
						return ok({
							op: input.op,
							path: join(tmpdir(), "mete-isolated", input.taskId),
							branch: input.taskId,
							sha: "base",
						});
					}
					if (input.op === "checkpoint.create") {
						const failed = await options.checkpoint?.(ctx);
						if (failed) return err({ code: "io", message: failed });
						checkpoints.push(ctx);
						return ok({
							op: input.op,
							ref: `refs/mete/checkpoints/${input.runId}/${checkpoints.length}`,
							sha: "saved",
						});
					}
					return ok({ op: "merge", sha: "merged" });
				},
			};
			h.checkpointAdapters.add(vcs);
			const provideCheckpoint = (impl: VcsGitAdapter) =>
				h.registry.provide("vcs.git@2", {
					id: "fixture-vcs",
					trust: "core",
					features: [],
					impl,
				});
			let checkpointRegistration = provideCheckpoint(vcs);
			replaceCheckpoint = (adapter) => {
				checkpointRegistration.dispose();
				checkpointRegistration = provideCheckpoint(adapter);
			};
			if (options.descriptor === false) return;
			h.registry.provide<ToolIsolationAdapter>("tool.isolation@1", {
				id: "fake-fs.write@1",
				trust: "core",
				features: [],
				impl: {
					inspect: async (input, signal) => {
						await options.inspect?.(signal);
						const root =
							input.cwd &&
							(options.claim ? options.claim(input.cwd) : input.cwd);
						return ok(
							root ? { scope: "worktree", root } : { scope: "workspace" },
						);
					},
				},
			});
		},
	});
	return {
		h: held,
		models,
		writes,
		called,
		checkpoints,
		replaceWriter,
		replaceCheckpoint,
		created,
		verified,
	};
};

describe("verified parallel writers", () => {
	it("does not execute a task's verification while a peer write remains in flight", async () => {
		const f = await isolatedHarness({ verify: true });
		await untilRequests(f.h, 2);
		for (const model of f.models) model.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(2));
		f.writes[0]?.release();
		await untilRequests(f.h, 3);
		await vi.waitFor(() =>
			expect(
				stateOf(f.h)?.context.team?.tasks.a?.messages.at(-1),
			).toMatchObject({
				role: "assistant",
				content: "done",
			}),
		);
		await tick();
		expect(f.verified).toEqual([]);
		f.writes[1]?.release();
		await untilStatus(f.h, "completed");
		expect(f.verified).toHaveLength(1);
		expect(f.verified[0]?.cwd).toBe(f.called[0]?.cwd);
	});

	it.each(["unknown", "wrapper"] as const)(
		"keeps a %s checkpoint adapter exclusive even with a valid writer descriptor",
		async (kind) => {
			const f = await isolatedHarness();
			await untilRequests(f.h, 2);
			const chain = f.h.registry.resolve<VcsGitAdapter>("vcs.git@2");
			if (!chain.ok) throw new Error("checkpoint adapter missing");
			const native = chain.value[0].impl;
			expect(f.h.checkpointAdapters.has(native)).toBe(true);
			if (kind === "unknown") f.h.checkpointAdapters.delete(native);
			else {
				const wrapper: VcsGitAdapter = {
					run: (input, ctx) => native.run(input, ctx),
				};
				expect(f.h.checkpointAdapters.has(wrapper)).toBe(false);
				f.replaceCheckpoint(wrapper);
			}
			f.models[0]?.release();
			await vi.waitFor(() =>
				expect(stateOf(f.h)?.context.team?.tasks.a?.messages.at(-1)?.role).toBe(
					"assistant",
				),
			);
			await tick();
			expect(f.called).toEqual([]);
			expect(f.checkpoints).toEqual([]);
			f.models[1]?.release();
			await vi.waitFor(() => expect(f.called).toHaveLength(1));
			await tick();
			expect(f.called).toHaveLength(1);
			f.writes[0]?.release();
			await vi.waitFor(() => expect(f.called).toHaveLength(2));
			f.writes[1]?.release();
			await untilStatus(f.h, "completed");
			for (const task of ["a", "b"])
				expect(toolResults(f.h, task)).toHaveLength(1);
		},
	);

	it("does not dispatch a stale writer when the checkpoint adapter is replaced during allocation", async () => {
		const checkpoint = gate();
		let started = 0;
		let replacementCheckpoints = 0;
		const f = await isolatedHarness({
			checkpoint: async () => {
				started++;
				await checkpoint.wait;
			},
		});
		await untilRequests(f.h, 2);
		const chain = f.h.registry.resolve<VcsGitAdapter>("vcs.git@2");
		if (!chain.ok) throw new Error("checkpoint adapter missing");
		const native = chain.value[0].impl;
		f.models[0]?.release();
		await vi.waitFor(() => expect(started).toBe(1));
		const replacement: VcsGitAdapter = {
			run: (input, ctx) => {
				if (input.op === "checkpoint.create") replacementCheckpoints++;
				return native.run(input, ctx);
			},
		};
		f.replaceCheckpoint(replacement);
		expect(f.h.checkpointAdapters.has(replacement)).toBe(false);
		checkpoint.release();
		await vi.waitFor(() => expect(f.checkpoints).toHaveLength(1));
		await tick();
		expect(f.called).toEqual([]);
		expect(replacementCheckpoints).toBe(0);
		const session = stateOf(f.h)?.context.team?.tasks.a?.session;
		expect(session?.inFlight).toBeUndefined();
		expect(session?.checkpointed).toBe(-1);
		f.models[1]?.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(1));
		expect(replacementCheckpoints).toBe(1);
		expect(f.checkpoints).toHaveLength(2);
		f.writes[0]?.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(2));
		f.writes[1]?.release();
		await untilStatus(f.h, "completed");
		expect(f.called).toHaveLength(2);
	});

	it("overlaps only independent writes after durable task-local checkpoints and markers", async () => {
		const f = await isolatedHarness();
		await untilRequests(f.h, 2);
		f.models[0]?.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(1));
		expect(f.h.requests).toHaveLength(2);
		expect(stateOf(f.h)?.context.team?.tasks.b?.context.worktree).toBeTruthy();
		f.models[1]?.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(2));
		expect(new Set(f.called.map((c) => c.cwd)).size).toBe(2);
		expect(new Set(f.called.map((c) => c.agentId)).size).toBe(2);
		expect(f.checkpoints.filter((c) => c.cwd)).toHaveLength(2);
		expect(f.h.requests).toHaveLength(2);
		for (const write of f.writes) write.release();
		await untilStatus(f.h, "completed");
		for (const task of ["a", "b"]) {
			expect(toolResults(f.h, task)).toHaveLength(1);
			expect(
				stateOf(f.h)?.context.team?.tasks[task]?.session?.inFlight,
			).toBeUndefined();
		}
	});

	it.each(["missing", "absent", "mapped", "equal", "nested"] as const)(
		"keeps %s confinement exclusive until its peer drains",
		async (kind) => {
			let first: string | undefined;
			const root = join(tmpdir(), "mete-shared-writer");
			const f = await isolatedHarness({
				descriptor: kind !== "absent",
				mapped: kind === "mapped",
				claim: (cwd) => {
					if (kind === "missing") return undefined;
					first ??= cwd;
					return kind === "nested" && cwd !== first
						? join(root, "child")
						: root;
				},
			});
			await untilRequests(f.h, 2);
			for (const model of f.models) model.release();
			await vi.waitFor(() => expect(f.called).toHaveLength(1));
			expect(f.called).toHaveLength(1);
			f.writes[0]?.release();
			await vi.waitFor(() => expect(f.called).toHaveLength(2));
			f.writes[1]?.release();
			await untilStatus(f.h, "completed");
		},
	);

	it("does not invoke a writer if paused during checkpoint creation", async () => {
		const checkpoint = gate();
		let attempted = 0;
		const f = await isolatedHarness({
			checkpoint: async () => {
				attempted++;
				await checkpoint.wait;
			},
		});
		await untilRequests(f.h, 2);
		f.models[0]?.release();
		await vi.waitFor(() => expect(attempted).toBe(1));
		await f.h.engine.pause(f.h.runId);
		checkpoint.release();
		await f.h.stop();
		expect(f.called).toEqual([]);
		expect(
			stateOf(f.h)?.context.team?.tasks.a?.session?.inFlight,
		).toBeUndefined();
	});

	it("fails closed when the checkpoint fails, with no tool invocation or marker", async () => {
		const f = await isolatedHarness({
			checkpoint: async () => "checkpoint refused",
		});
		await untilRequests(f.h, 2);
		f.models[0]?.release();
		await untilStatus(f.h, "failed");
		expect(stateOf(f.h)?.context.error?.code).toBe("checkpoint_failed");
		expect(f.called).toEqual([]);
		expect(
			stateOf(f.h)?.context.team?.tasks.a?.session?.inFlight,
		).toBeUndefined();
	});

	it("rechecks a replaced adapter after the checkpoint await instead of dispatching its old preparation", async () => {
		const checkpoint = gate();
		let inspected = 0;
		let started = 0;
		let replacements = 0;
		const f = await isolatedHarness({
			claim: (cwd) => {
				inspected++;
				return cwd;
			},
			checkpoint: async () => {
				started++;
				await checkpoint.wait;
			},
		});
		await untilRequests(f.h, 2);
		f.models[0]?.release();
		await vi.waitFor(() => expect(started).toBe(1));
		f.replaceWriter(async () => {
			expect(inspected).toBe(2);
			expect(stateOf(f.h)?.context.team?.tasks.a?.session?.inFlight).toBe(
				"call-0-fs_write",
			);
			replacements++;
			return ok({ bytes: 1 });
		});
		expect(replacements).toBe(0);
		checkpoint.release();
		await vi.waitFor(() => expect(replacements).toBe(1));
		expect(f.called).toEqual([]);
		expect(started).toBe(2);
		await f.h.engine.pause(f.h.runId);
	});

	it("does not dispatch the old checkpoint owner across immediate pause/resume", async () => {
		const checkpoint = gate();
		let attempted = 0;
		const f = await isolatedHarness({
			checkpoint: async () => {
				attempted++;
				await checkpoint.wait;
			},
		});
		await untilRequests(f.h, 2);
		f.models[0]?.release();
		await vi.waitFor(() => expect(attempted).toBe(1));
		await f.h.engine.pause(f.h.runId);
		await f.h.engine.resume(f.h.runId);
		expect(f.called).toEqual([]);
		checkpoint.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(1));
		expect(attempted).toBe(2);
		f.writes[0]?.release();
		await untilStatus(f.h, "completed");
	});

	it("seats a recovered workspace-fallback writer before running a different active task", async () => {
		const checkpoint = gate();
		let attempted = 0;
		const f = await isolatedHarness({
			checkpoint: async () => {
				attempted++;
				await checkpoint.wait;
			},
		});
		await untilRequests(f.h, 2);
		f.models[0]?.release();
		await vi.waitFor(() => expect(attempted).toBe(1));
		await f.h.engine.pause(f.h.runId);
		checkpoint.release();
		await f.h.stop();
		const row = f.h.store.load(f.h.runId);
		const team = row?.snapshot.context.team;
		const a = team?.tasks.a;
		const b = team?.tasks.b;
		if (!row || !team || !a || !b) throw new Error("missing tasks");
		const { worktree: _worktree, ...workspace } = a.context;
		f.h.store.save(
			row.meta,
			runMachine.resolveState({
				value: "paused",
				context: {
					...row.snapshot.context,
					task: "b",
					messages: b.messages,
					team: {
						...team,
						tasks: { ...team.tasks, a: { ...a, context: workspace } },
					},
				},
			}),
		);
		const write = gate();
		const contexts: ToolContext[] = [];
		later = engineHarness({
			db: f.h.db,
			templates: f.h.templates,
			scripts: [reply("done")],
			tools: [
				[
					"fs.write@1",
					async (input, ctx) => {
						expect(FsWriteInputSchema.parse(input)).toMatchObject({
							path: "a.txt",
						});
						contexts.push(ctx);
						await write.wait;
						return ok({ bytes: 1 });
					},
				],
			],
		});
		await later.engine.resume(f.h.runId);
		await vi.waitFor(() => expect(contexts).toHaveLength(1));
		expect(contexts[0]?.cwd).toBeUndefined();
		expect(contexts[0]?.agentId).toBe(a.context.agentId);
		expect(later.requests).toEqual([]);
		write.release();
		await vi.waitFor(() => expect(toolResults(f.h, "a")).toHaveLength(1));
	});

	it("counts preparation, checkpoint and write alongside the held model and defers fresh worktree setup", async () => {
		const inspection = gate();
		const checkpoint = gate();
		let inspected = 0;
		let checkpointed = 0;
		const f = await isolatedHarness({
			extraTask: true,
			inspect: async () => {
				inspected++;
				await inspection.wait;
			},
			checkpoint: async () => {
				checkpointed++;
				await checkpoint.wait;
			},
		});
		await untilRequests(f.h, 2);
		f.models[0]?.release();
		await vi.waitFor(() => expect(inspected).toBe(1));
		expect(f.h.requests).toHaveLength(2);
		expect(f.created).toHaveLength(2);
		expect(checkpointed).toBe(0);
		inspection.release();
		await vi.waitFor(() => expect(checkpointed).toBe(1));
		expect(f.h.requests).toHaveLength(2);
		expect(f.called).toEqual([]);
		checkpoint.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(1));
		f.models[1]?.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(2));
		f.writes[1]?.release();
		await untilRequests(f.h, 3);
		expect(f.created).toHaveLength(2);
		f.writes[0]?.release();
		await untilStatus(f.h, "completed");
		expect(f.created).toHaveLength(3);
	});

	it("does not checkpoint or invoke when pause changes the token during preparation", async () => {
		const inspection = gate();
		let inspected = 0;
		const f = await isolatedHarness({
			inspect: async () => {
				inspected++;
				await inspection.wait;
			},
		});
		await untilRequests(f.h, 2);
		f.models[0]?.release();
		await vi.waitFor(() => expect(inspected).toBe(1));
		await f.h.engine.pause(f.h.runId);
		inspection.release();
		await f.h.stop();
		expect(f.checkpoints).toEqual([]);
		expect(f.called).toEqual([]);
	});

	it("drains both writes across immediate pause/resume and retains each result once", async () => {
		const f = await isolatedHarness();
		await untilRequests(f.h, 2);
		for (const model of f.models) model.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(2));
		await f.h.engine.pause(f.h.runId);
		expect(f.called.every((ctx) => !ctx.signal.aborted)).toBe(true);
		await f.h.engine.resume(f.h.runId);
		f.writes[0]?.release();
		await tick();
		expect(f.h.requests).toHaveLength(2);
		f.writes[1]?.release();
		await untilStatus(f.h, "completed");
		expect(f.called).toHaveLength(2);
		for (const task of ["a", "b"])
			expect(toolResults(f.h, task)).toHaveLength(1);
	});

	it("signals cancellation but never detaches abort-ignoring writers or erases uncertain markers", async () => {
		const f = await isolatedHarness();
		await untilRequests(f.h, 2);
		for (const model of f.models) model.release();
		await vi.waitFor(() => expect(f.called).toHaveLength(2));
		await f.h.engine.cancel(f.h.runId);
		expect(f.called.every((ctx) => ctx.signal.aborted)).toBe(true);
		let stopped = false;
		const stopping = f.h.stop().then(() => {
			stopped = true;
		});
		await tick();
		expect(stopped).toBe(false);
		for (const write of f.writes) write.release();
		await stopping;
		expect(stateOf(f.h)?.value).toBe("cancelled");
		for (const task of ["a", "b"]) {
			expect(toolResults(f.h, task)).toEqual([]);
			expect(stateOf(f.h)?.context.team?.tasks[task]?.session?.inFlight).toBe(
				"call-0-fs_write",
			);
		}
	});

	it.each(["result", "approval"] as const)(
		"settles a peer %s after an approval pause without an uncertain approval marker",
		async (kind) => {
			const ask = gate();
			const peer = gate();
			const f = await isolatedHarness();
			await untilRequests(f.h, 2);
			const agentA = stateOf(f.h)?.context.team?.tasks.a?.context.agentId;
			let invoked = 0;
			f.replaceWriter(async (_input, ctx) => {
				invoked++;
				const first = ctx.agentId === agentA;
				await (first ? ask : peer).wait;
				return first || kind === "approval"
					? err({ code: "approval_required", rule: "fixture", message: "ask" })
					: ok({ bytes: 1 });
			});
			for (const model of f.models) model.release();
			await vi.waitFor(() => expect(invoked).toBe(2));
			ask.release();
			await untilStatus(f.h, "paused");
			expect(
				stateOf(f.h)?.context.team?.tasks.a?.session?.inFlight,
			).toBeUndefined();
			expect(stateOf(f.h)?.context.team?.tasks.b?.session?.inFlight).toBe(
				"call-0-fs_write",
			);
			peer.release();
			await vi.waitFor(() =>
				expect(
					stateOf(f.h)?.context.team?.tasks.b?.session?.inFlight,
				).toBeUndefined(),
			);
			expect(toolResults(f.h, "a")).toEqual([]);
			expect(toolResults(f.h, "b")).toHaveLength(kind === "approval" ? 0 : 1);
		},
	);

	it("retains a throwing writer's marker, drains its successful peer and refuses replay on resume", async () => {
		const failure = gate();
		const peer = gate();
		const f = await isolatedHarness();
		await untilRequests(f.h, 2);
		const agentA = stateOf(f.h)?.context.team?.tasks.a?.context.agentId;
		let invoked = 0;
		f.replaceWriter(async (_input, ctx) => {
			invoked++;
			if (ctx.agentId === agentA) {
				await failure.wait;
				throw new Error("writing outcome unknown");
			}
			await peer.wait;
			return ok({ bytes: 1 });
		});
		for (const model of f.models) model.release();
		await vi.waitFor(() => expect(invoked).toBe(2));
		await f.h.engine.pause(f.h.runId);
		failure.release();
		peer.release();
		await vi.waitFor(() => expect(toolResults(f.h, "b")).toHaveLength(1));
		expect(stateOf(f.h)?.context.team?.tasks.a?.session?.inFlight).toBe(
			"call-0-fs_write",
		);
		await f.h.engine.resume(f.h.runId);
		await untilStatus(f.h, "paused");
		expect(stateOf(f.h)?.context.pause?.reason).toBe("user");
		expect(invoked).toBe(2);
	});
});
