import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	err,
	type McpToolsAdapter,
	ok,
	parseTemplate,
	type ToolCall,
	type ToolContext,
	WebFetchInputSchema,
} from "@mete/contracts";
import { createConfigReader } from "@mete/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialTransition } from "xstate";
import {
	schedule,
	schedulerState,
} from "../../src/application/parallel-scheduler.js";
import {
	apply,
	type EngineState,
	hold,
} from "../../src/application/run-state.js";
import { stopScheduler } from "../../src/application/scheduler-drain.js";
import { createSkillLoadAuthority } from "../../src/application/skill-load-authority.js";
import { applyWorker } from "../../src/application/task-worker.js";
import { submit } from "../../src/application/team-driver.js";
import {
	callWorkerTool,
	parallelTool,
	settleWorkerTool,
} from "../../src/application/worker-tool.js";
import { nextStep } from "../../src/domain/next-step.js";
import { runMachine } from "../../src/domain/run-machine.js";
import { taskContext } from "../../src/domain/task-worker.js";
import { applyTask, teamOf } from "../../src/domain/team.js";
import {
	engineHarness,
	recordingLogger,
	reply,
	T0,
	type Tool,
} from "../helpers/engine.js";
import {
	gatedReply,
	gatedStream,
	type SchedulerHarness,
	schedulerHarness,
	stateOf,
	untilRequests,
	untilStatus,
} from "../helpers/scheduler.js";

let held: SchedulerHarness | undefined;
const releases: (() => void)[] = [];
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const release of releases.splice(0)) release();
	await held?.cleanup();
	for (const dispose of disposals.splice(0)) await dispose();
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

const fetchReply = (id: string) =>
	reply("", [
		{ name: "web_fetch", args: { url: `https://example.test/${id}` } },
	]);
const readers = (source: string) =>
	source.replaceAll("capabilities: []", "capabilities: [web.fetch@1]");
const results = (h: SchedulerHarness, task: string) =>
	stateOf(h)?.context.team?.tasks[task]?.messages.filter(
		(m) => m.role === "tool",
	);

const workerFixture = (run: Tool) => {
	const h = engineHarness({ scripts: [], tools: [["web.fetch@1", run]] });
	const workspaceId = randomUUID();
	const state: EngineState = {
		live: new Map(),
		onPauseEnded() {},
		skillLoads: createSkillLoadAuthority(),
		deps: {
			workspaceId,
			registry: h.registry,
			events: h.bus,
			store: h.store,
			logger: recordingLogger().logger,
			now: () => T0,
			newId: randomUUID,
			config: createConfigReader({
				global: { file: "settings.yaml", sections: {} },
				workspace: {},
			}),
			setTimer: () => () => {},
			os: "TestOS",
			platform: "linux",
		},
	};
	const parsed = parseTemplate({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id: "workers", name: "Workers", version: "1.0.0" },
		pattern: "parallel_then_synthesize",
		roles: [
			{
				id: "reader",
				name: "Reader",
				goal: "Read",
				tier: "fast",
				capabilities: ["web.fetch@1"],
			},
		],
		tasks: ["a", "b"].map((id) => ({ id, role: "reader", title: id })),
	});
	if (!parsed.ok) throw new Error(parsed.error.issues.join("\n"));
	let team = teamOf(parsed.value);
	for (const id of ["a", "b"]) {
		team = applyTask(team, id, { type: "START", agentId: randomUUID() }).team;
		const entry = team.tasks[id];
		if (!entry) throw new Error("missing fixture task");
		team = {
			...team,
			tasks: {
				...team.tasks,
				[id]: {
					...entry,
					context: {
						...entry.context,
						worktree: join(tmpdir(), `mete-owned-${id}`),
					},
				},
			},
		};
	}
	const snapshot = initialTransition(runMachine, {
		goal: "Research",
		priority: 1,
		messages: [{ role: "user", content: "Coordinator" }],
	})[0];
	const live = hold(
		state,
		{
			id: randomUUID(),
			workspaceId,
			budget: { cloudRequests: 10, maxHours: 1 },
			autonomyLevel: 2,
			createdAt: new Date(T0).toISOString(),
		},
		snapshot,
	);
	apply(state, live, { type: "START", at: T0 });
	apply(state, live, { type: "TEAM", team });
	live.model = new AbortController();
	for (const task of ["a", "b"]) {
		const agentId = team.tasks[task]?.context.agentId;
		if (!agentId) throw new Error("missing fixture agent");
		applyWorker(state, live, task, {
			type: "MODEL",
			agent: { id: agentId, roleId: "reader", providerId: "p", modelId: task },
		});
		applyWorker(state, live, task, {
			type: "REPLIED",
			finish: "tool-calls",
			message: {
				role: "assistant",
				content: "",
				toolCalls: [
					{
						id: "reused",
						name: "web_fetch",
						args: { url: `https://example.test/${task}` },
					},
				],
			},
		});
	}
	disposals.push(async () => {
		live.all.abort();
		await h.stop();
		h.db.close();
	});
	const input = (task: string) => {
		const context = taskContext(live.snapshot.context, task);
		if (!context) throw new Error("missing fixture context");
		const step = nextStep(context, live.meta.budget, T0);
		if (step.kind !== "tool") throw new Error("missing fixture tool");
		return { task, context, step };
	};
	return { state, live, input, events: h.events };
};

describe("task-local scheduler tools", () => {
	it("preserves a peer write marker while a no-verify submission repairs its guardrail", async () => {
		const { state, live } = workerFixture(async () => ok({}));
		const team = live.snapshot.context.team;
		if (!team) throw new Error("missing team");
		apply(state, live, {
			type: "TEAM",
			team: {
				...team,
				template: {
					...team.template,
					tasks: team.template.tasks.map((task) =>
						task.id === "a"
							? {
									...task,
									guardrail: { schema: "research-report@1", max_retries: 2 },
								}
							: task,
					),
				},
			},
		});
		apply(state, live, { type: "ACTIVATE", task: "a" });
		const submitting = submit(state, live, "not a report");
		applyWorker(state, live, "b", {
			type: "TOOL_STARTED",
			callId: "writing-b",
		});
		await submitting;
		expect(live.snapshot.context.team?.tasks.a?.repairs).toBe(1);
		expect(taskContext(live.snapshot.context, "b")?.inFlight).toBe("writing-b");
		expect(
			state.deps.store.load(live.meta.id)?.snapshot.context.team?.tasks.b
				?.session?.inFlight,
		).toBe("writing-b");
	});

	it("preserves a peer's newly persisted write marker across the coordinator await", async () => {
		const { state, live } = workerFixture(async () => ok({}));
		const team = live.snapshot.context.team;
		if (!team) throw new Error("missing team");
		apply(state, live, {
			type: "TEAM",
			team: applyTask(team, "a", { type: "SUBMIT", report: "A done" }).team,
		});
		const scheduled = schedule(state, live, schedulerState());
		applyWorker(state, live, "b", {
			type: "TOOL_STARTED",
			callId: "writing-b",
		});
		expect(taskContext(live.snapshot.context, "b")?.inFlight).toBe("writing-b");
		await scheduled;
		expect(live.snapshot.context.team?.tasks.a?.status).toBe("approved");
		expect(taskContext(live.snapshot.context, "b")?.inFlight).toBe("writing-b");
		const saved = state.deps.store.load(live.meta.id);
		expect(saved?.snapshot.context.team?.tasks.b?.session?.inFlight).toBe(
			"writing-b",
		);
	});

	it("keeps raw MCP tools exclusive even when the server describes them as reads", async () => {
		const a = gatedStream(reply("", [{ name: "mcp_fake_read", args: {} }]));
		const b = gatedReply("b");
		releases.push(a.release, b.release);
		let calls = 0;
		held = await schedulerHarness({
			scripts: [a.script, b.script, reply("done")],
			rewrite: (source) =>
				source.replaceAll("capabilities: []", "capabilities: [mcp.tools@1]"),
			configure: (h) => {
				h.registry.provide<McpToolsAdapter>("mcp.tools@1", {
					id: "fake-mcp",
					trust: "core",
					features: [],
					impl: {
						list: async () =>
							ok([
								{
									server: "fake",
									name: "read",
									description: "Read only",
									inputSchema: { type: "object" },
								},
							]),
						call: async () => {
							calls++;
							return ok({ content: [], isError: false });
						},
					},
				});
			},
		});
		const h = held;
		await untilRequests(h, 2);
		a.release();
		await vi.waitFor(() =>
			expect(stateOf(h)?.context.team?.tasks.a?.messages.at(-1)?.role).toBe(
				"assistant",
			),
		);
		expect(calls).toBe(0);
		expect(h.events.filter((e) => e.type === "checkpoint.created")).toEqual([]);
		b.release();
		await untilStatus(h, "completed");
		expect(calls).toBe(1);
		expect(results(h, "a")).toHaveLength(1);
		expect(
			stateOf(h)?.context.team?.tasks.a?.session?.inFlight,
		).toBeUndefined();
	});

	it("overlaps two tools and a tool with a model under the same two slots, without tool reservations", async () => {
		const a = gatedStream(fetchReply("a"));
		const b = gatedStream(fetchReply("b"));
		const reportA = gatedReply("a");
		const reportB = gatedReply("b");
		releases.push(a.release, b.release, reportA.release, reportB.release);
		const tools = { a: gate(), b: gate() };
		const contexts: ToolContext[] = [];
		let active = 0;
		let peak = 0;
		held = await schedulerHarness({
			scripts: [
				a.script,
				b.script,
				reportA.script,
				reportB.script,
				reply("c"),
				reply("d"),
			],
			rewrite: readers,
			tools: [
				[
					"web.fetch@1",
					async (input, ctx) => {
						const { url } = WebFetchInputSchema.parse(input);
						contexts.push(ctx);
						peak = Math.max(peak, ++active);
						await (url.endsWith("/a") ? tools.a : tools.b).wait;
						active--;
						return ok({ markdown: url, title: url, finalUrl: url });
					},
				],
			],
		});
		const h = held;
		await untilRequests(h, 2);
		a.release();
		await vi.waitFor(() => expect(contexts).toHaveLength(1));
		expect(stateOf(h)?.context.reservations).toHaveLength(1);
		b.release();
		await vi.waitFor(() => expect(contexts).toHaveLength(2));
		expect(active).toBe(2);
		expect(peak).toBe(2);
		expect(stateOf(h)?.context.reservations).toEqual([]);
		expect(stateOf(h)?.context.requests).toBe(2);
		expect(stateOf(h)?.context.team?.tasks.c?.status).toBe("todo");
		tools.a.release();
		await untilRequests(h, 3);
		expect(active).toBe(1);
		expect(stateOf(h)?.context.reservations).toHaveLength(1);
		expect(stateOf(h)?.context.team?.tasks.c?.status).toBe("todo");
		expect(results(h, "a")).toHaveLength(1);
		expect(results(h, "b")).toEqual([]);
		expect(results(h, "a")?.[0]?.content).toContain("https://example.test/a");
		tools.b.release();
		await untilRequests(h, 4);
		expect(results(h, "b")?.[0]?.content).toContain("https://example.test/b");
		expect(contexts.map((ctx) => ctx.agentId)).toEqual([
			stateOf(h)?.context.team?.tasks.a?.context.agentId,
			stateOf(h)?.context.team?.tasks.b?.context.agentId,
		]);
		for (const task of ["a", "b"]) {
			const entry = stateOf(h)?.context.team?.tasks[task];
			const events = h.events.filter(
				(e) => e.taskId === entry?.id && e.type.startsWith("agent.tool."),
			);
			expect(events.map((e) => e.type)).toEqual([
				"agent.tool.called",
				"agent.tool.completed",
			]);
			expect(events.every((e) => e.agentId === entry?.context.agentId)).toBe(
				true,
			);
		}
		reportA.release();
		reportB.release();
		await untilStatus(h, "completed");
		expect(stateOf(h)?.context.requests).toBe(6);
		expect(stateOf(h)?.context.team?.tasks.a?.session?.tainted).toBe(true);
		expect(stateOf(h)?.context.team?.tasks.b?.session?.tainted).toBe(true);
	});

	it.each([false, true])(
		"drains both started tools without abort or replay on pause (immediate resume: %s)",
		async (resumeNow) => {
			const tools = [gate(), gate()];
			const contexts: ToolContext[] = [];
			held = await schedulerHarness({
				scripts: [fetchReply("a"), fetchReply("b"), reply("done")],
				rewrite: readers,
				tools: [
					[
						"web.fetch@1",
						async (_input, ctx) => {
							const i = contexts.push(ctx) - 1;
							await tools[i]?.wait;
							return ok({
								markdown: `result-${i}`,
								title: "Result",
								finalUrl: "https://example.test/",
							});
						},
					],
				],
			});
			const h = held;
			await vi.waitFor(() => expect(contexts).toHaveLength(2));
			expect((await h.engine.pause(h.runId)).ok).toBe(true);
			if (resumeNow) expect((await h.engine.resume(h.runId)).ok).toBe(true);
			expect(contexts.every((ctx) => !ctx.signal.aborted)).toBe(true);
			expect(h.requests).toHaveLength(2);
			tools[0]?.release();
			tools[1]?.release();
			await vi.waitFor(() => {
				expect(results(h, "a")).toHaveLength(1);
				expect(results(h, "b")).toHaveLength(1);
			});
			if (!resumeNow) {
				expect(stateOf(h)?.value).toBe("paused");
				expect(h.requests).toHaveLength(2);
				expect((await h.engine.resume(h.runId)).ok).toBe(true);
			}
			await untilStatus(h, "completed");
			expect(contexts).toHaveLength(2);
			expect(results(h, "a")).toHaveLength(1);
			expect(results(h, "b")).toHaveLength(1);
		},
	);

	it.each(["cancel", "stop"] as const)(
		"aborts all started tools on %s and drops abort-ignoring late results",
		async (action) => {
			const blocked = gate();
			const contexts: ToolContext[] = [];
			let finished = 0;
			held = await schedulerHarness({
				scripts: [fetchReply("a"), fetchReply("b")],
				rewrite: readers,
				tools: [
					[
						"web.fetch@1",
						async (_input, ctx) => {
							contexts.push(ctx);
							await blocked.wait;
							finished++;
							return ok({
								markdown: "late",
								title: "Late",
								finalUrl: "https://example.test/",
							});
						},
					],
				],
			});
			const h = held;
			await vi.waitFor(() => expect(contexts).toHaveLength(2));
			if (action === "cancel")
				expect((await h.engine.cancel(h.runId)).ok).toBe(true);
			await h.stop();
			expect(contexts.every((ctx) => ctx.signal.aborted)).toBe(true);
			expect(stateOf(h)?.value).toBe(
				action === "cancel" ? "cancelled" : "paused",
			);
			blocked.release();
			await vi.waitFor(() => expect(finished).toBe(2));
			expect(results(h, "a")).toEqual([]);
			expect(results(h, "b")).toEqual([]);
			expect(h.requests).toHaveLength(2);
			expect(h.events.filter((e) => e.type === "agent.tool.completed")).toEqual(
				[],
			);
		},
	);

	it("keeps policy denial as a tool result and preserves the repeat guard and external taint on the next call", async () => {
		const firstA = gatedStream(fetchReply("a"));
		const nextB = gatedReply("b");
		releases.push(firstA.release, nextB.release);
		const contexts: ToolContext[] = [];
		held = await schedulerHarness({
			scripts: [
				firstA.script,
				nextB.script,
				fetchReply("a"),
				fetchReply("a"),
				reply("a"),
				reply("c"),
				reply("d"),
			],
			rewrite: readers,
			tools: [
				[
					"web.fetch@1",
					async (_input, ctx) => {
						contexts.push(ctx);
						return err({
							code: "denied",
							message: "Refused by policy",
							rule: "net",
						});
					},
				],
			],
		});
		const h = held;
		await untilRequests(h, 2);
		firstA.release();
		await vi.waitFor(() => expect(results(h, "a")).toHaveLength(3));
		expect(results(h, "a")).toHaveLength(3);
		expect(results(h, "a")?.[0]?.content).toContain('"code":"denied"');
		expect(results(h, "a")?.[2]?.content).toContain(
			"You made this same call before",
		);
		expect(contexts.map((ctx) => ctx.tainted === true)).toEqual([
			false,
			true,
			true,
		]);
		expect(stateOf(h)?.context.team?.tasks.b?.session?.tainted).toBe(false);
		nextB.release();
		await untilStatus(h, "completed");
	});

	it("leaves a policy ask unanswered while draining its peer, then retries only the refused tool on resume", async () => {
		const a = gate();
		const b = gate();
		const contexts: ToolContext[] = [];
		let asked = false;
		held = await schedulerHarness({
			scripts: [fetchReply("a"), fetchReply("b"), reply("done")],
			rewrite: readers,
			tools: [
				[
					"web.fetch@1",
					async (input, ctx) => {
						const { url } = WebFetchInputSchema.parse(input);
						contexts.push(ctx);
						if (url.endsWith("/a") && !asked) {
							asked = true;
							await a.wait;
							return err({
								code: "approval_required",
								message: "Ask first",
								rule: "net",
							});
						}
						if (url.endsWith("/b")) await b.wait;
						return ok({ markdown: url, title: "Page", finalUrl: url });
					},
				],
			],
		});
		const h = held;
		await vi.waitFor(() => expect(contexts).toHaveLength(2));
		a.release();
		await untilStatus(h, "paused");
		expect(stateOf(h)?.context.pause?.reason).toBe("approval");
		expect(results(h, "a")).toEqual([]);
		expect(contexts.every((ctx) => !ctx.signal.aborted)).toBe(true);
		b.release();
		await vi.waitFor(() => expect(results(h, "b")).toHaveLength(1));
		expect((await h.engine.resume(h.runId)).ok).toBe(true);
		await untilStatus(h, "completed");
		expect(contexts).toHaveLength(3);
		expect(results(h, "a")).toHaveLength(1);
		expect(results(h, "b")).toHaveLength(1);
	});
});

describe("worker tool ownership", () => {
	it("captures the task agent, cwd and taint and applies against the latest state without seating or replacing its peer", async () => {
		const blocked = gate();
		const contexts: ToolContext[] = [];
		const { state, live, input, events } = workerFixture(
			async (_input, ctx) => {
				contexts.push(ctx);
				await blocked.wait;
				return ok({
					markdown: "page",
					title: "Page",
					finalUrl: "https://example.test/",
				});
			},
		);
		applyWorker(state, live, "a", { type: "TAINT" });
		const captured = input("a");
		const call = callWorkerTool(state, live, captured);
		applyWorker(state, live, "b", { type: "TAINT" });
		const peer = live.snapshot.context.team?.tasks.b;
		blocked.release();
		await call.wait;
		settleWorkerTool(state, live, call);
		settleWorkerTool(state, live, call);
		expect(contexts).toHaveLength(1);
		expect(contexts[0]).toMatchObject({
			runId: live.meta.id,
			agentId: captured.context.agent?.id,
			cwd: join(tmpdir(), "mete-owned-a"),
			tainted: true,
		});
		expect(contexts[0]?.signal).toBe(live.all.signal);
		expect(live.snapshot.context.task).toBeUndefined();
		expect(live.snapshot.context.messages).toEqual([
			{ role: "user", content: "Coordinator" },
		]);
		expect(live.snapshot.context.team?.tasks.b).toBe(peer);
		expect(
			taskContext(live.snapshot.context, "a")?.messages.filter(
				(m) => m.role === "tool",
			),
		).toHaveLength(1);
		expect(live.snapshot.context.requests).toBe(2);
		expect(
			events
				.filter((e) => e.type.startsWith("agent.tool."))
				.map((e) => [e.taskId, e.agentId]),
		).toEqual([
			[call.as.taskId, call.as.agentId],
			[call.as.taskId, call.as.agentId],
		]);
	});

	it.each(["agent", "turn", "token"] as const)(
		"drops a result superseded by another %s without overwriting any task",
		async (identity) => {
			const blocked = gate();
			const { state, live, input } = workerFixture(async () => {
				await blocked.wait;
				return ok({ markdown: "stale" });
			});
			const call = callWorkerTool(state, live, input("a"));
			if (identity === "token") live.token = {};
			if (identity === "turn")
				applyWorker(state, live, "a", {
					type: "REPLIED",
					finish: "tool-calls",
					message: {
						role: "assistant",
						content: "replacement",
						toolCalls: [call.step.call],
					},
				});
			if (identity === "agent") {
				const team = live.snapshot.context.team;
				const entry = team?.tasks.a;
				if (!team || !entry) throw new Error("missing fixture task");
				apply(state, live, {
					type: "TEAM",
					team: {
						...team,
						tasks: {
							...team.tasks,
							a: {
								...entry,
								context: { ...entry.context, agentId: randomUUID() },
							},
						},
					},
				});
			}
			const latest = live.snapshot.context;
			blocked.release();
			await call.wait;
			settleWorkerTool(state, live, call);
			expect(live.snapshot.context).toBe(latest);
		},
	);

	it("retiring a superseded scheduler cannot authorize a stale tool by aborting its model controller", async () => {
		const blocked = gate();
		const { state, live } = workerFixture(async () => {
			await blocked.wait;
			return ok({ markdown: "stale" });
		});
		const scheduler = schedulerState();
		await schedule(state, live, scheduler);
		live.token = {};
		const latest = live.snapshot.context;
		blocked.release();
		await stopScheduler(state, live, scheduler);
		expect(live.snapshot.context).toBe(latest);
		expect(scheduler.pending.size).toBe(0);
	});

	it.each([
		{ id: "write", name: "fs_write", args: { path: "a", content: "a" } },
		{ id: "shell", name: "shell_exec", args: { command: "write" } },
		{ id: "mcp", name: "mcp_server_lookup", args: {} },
		{ id: "unknown", name: "unknown_write", args: {} },
		{ id: "commit", name: "vcs_git", args: { op: "commit", message: "write" } },
		{ id: "unknown-op", name: "vcs_git", args: { op: "unknown" } },
	] satisfies ToolCall[])(
		"never admits potentially writing or unknown $id calls to concurrent execution",
		(call) => {
			const { input } = workerFixture(async () => ok({}));
			const captured = input("a");
			const team = captured.context.team;
			if (!team) throw new Error("missing fixture team");
			const context = {
				...captured.context,
				team: {
					...team,
					template: {
						...team.template,
						roles: team.template.roles.map((role) => ({
							...role,
							capabilities: [
								"web.fetch@1",
								"fs.write@1",
								"shell.exec@1",
								"vcs.git@2",
								"mcp.tools@1",
							] as const,
						})),
					},
				},
			};
			expect(parallelTool(context, { ...captured.step, call })).toBe(false);
		},
	);
});
