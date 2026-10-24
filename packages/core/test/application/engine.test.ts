import type { LlmChunk, RunView } from "@mete/contracts";
import { err, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { MAX_TURNS } from "../../src/defaults.js";
import {
	engineHarness,
	reply,
	slow,
	T0,
	type Tool,
	typesOf,
} from "../helpers/engine.js";

type H = ReturnType<typeof engineHarness>;

const begin = async (h: H, goal = "rename foo to bar") => {
	const r = await h.engine.start({ goal });
	if (!r.ok) throw new Error(r.error.message);
	return r.value.runId;
};
const view = (h: H, runId: string): RunView | undefined => {
	const r = h.engine.status(runId);
	return r.ok ? r.value[0] : undefined;
};
const settled = (h: H, runId: string, status: string) =>
	vi.waitFor(() => expect(view(h, runId)?.status).toBe(status));

const edited = ok({ replacements: 1 });
const checkpointed = (runId: string) =>
	ok({
		op: "checkpoint.create",
		ref: `refs/mete/checkpoints/${runId}/1`,
		sha: "a",
	});

describe("single-agent engine", () => {
	it("finishes an edit task with a checkpoint first and records the agent", async () => {
		const vcs = vi.fn(async (input: unknown) =>
			checkpointed(String(Object(input).runId)),
		);
		const edit = vi.fn<Tool>(async () => edited);
		const h = engineHarness({
			scripts: [
				reply("", [
					{
						name: "fs_edit",
						args: { path: "a.ts", oldStr: "foo", newStr: "bar" },
					},
				]),
				reply("Renamed foo to bar."),
			],
			tools: [
				["fs.edit@1", edit],
				["vcs.git@2", vcs],
			],
		});
		const runId = await begin(h);
		await settled(h, runId, "completed");
		expect(vcs).toHaveBeenCalledWith(
			{ op: "checkpoint.create", runId },
			expect.anything(),
		);
		expect(edit.mock.calls[0]?.[1].runId).toBe(runId);
		expect(typesOf(h.events)).toEqual([
			"run.created",
			"run.started",
			"agent.thinking.started",
			"agent.created",
			"agent.thinking.ended",
			"checkpoint.created",
			"agent.tool.called",
			"agent.tool.completed",
			"agent.thinking.started",
			"agent.thinking.ended",
			"run.completed",
		]);
		expect(h.events.at(-1)?.payload).toEqual({
			summary: "Renamed foo to bar.",
		});
		// Each call's token counts close it on the agent's envelope, the first call too, for the
		// Team view's context share (ADR-090).
		const ended = h.events.filter((e) => e.type === "agent.thinking.ended");
		const agentId = h.events.find((e) => e.type === "agent.created")?.agentId;
		expect(agentId).toBeDefined();
		expect(ended.map((e) => e.agentId)).toEqual([agentId, agentId]);
		expect(ended.map((e) => e.payload)).toEqual([
			{ usage: { prompt: 1, completion: 1 } },
			{ usage: { prompt: 1, completion: 1 } },
		]);
		expect(
			h.db.prepare("SELECT role_id, model_id, requests FROM agents").all(),
		).toEqual([{ role_id: "assistant", model_id: "m1", requests: 2 }]);
		const [first] = h.requests;
		expect(first).toMatchObject({
			target: { tier: "coder" },
			needs: ["tool_calling"],
			priority: 1,
			runId,
		});
		expect(first?.tools?.map((t) => t.name).sort()).toEqual([
			"fs_edit",
			"vcs_git",
		]);
		expect(first?.messages[0]?.content).toContain(
			"Operating system: TestOS 1. Shell: sh.",
		);
		expect(h.requests[1]?.messages.at(-1)).toMatchObject({
			role: "tool",
			content: JSON.stringify(edited),
		});
	});

	it("pauses on exhausted quota and resumes by itself at the reset", async () => {
		const resumesAt = new Date(T0 + 60_000).toISOString();
		const h = engineHarness({
			scripts: [
				[
					{
						type: "error",
						error: { code: "quota_exhausted", message: "q", resumesAt },
					},
				],
				reply("done"),
			],
		});
		const runId = await begin(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("quota");
		// A quota pause leaves no handoff; the end of the run does (docs/08, Run memory).
		const handoffs = () => h.db.prepare("SELECT state FROM handoffs").all();
		expect(handoffs()).toEqual([]);
		expect(h.timers.map((t) => t.ms)).toEqual([60_000]);
		h.clock.now = T0 + 60_000;
		h.timers[0]?.fn();
		await settled(h, runId, "completed");
		expect(handoffs()).toEqual([{ state: "open" }]);
		expect(typesOf(h.events).filter((t) => t.startsWith("run."))).toEqual([
			"run.created",
			"run.started",
			"run.paused",
			"run.resumed",
			"run.completed",
		]);
		// A call that ended with an error has no usage to report (ADR-090).
		expect(
			h.events
				.filter((e) => e.type === "agent.thinking.ended")
				.map((e) => e.payload),
		).toEqual([{}, { usage: { prompt: 1, completion: 1 } }]);
	});

	it("pauses on a network error and tries again by itself 30 seconds later", async () => {
		const h = engineHarness({
			scripts: [
				[{ type: "error", error: { code: "network", message: "offline" } }],
				reply("done"),
			],
		});
		const runId = await begin(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("network");
		// Like a quota pause, it leaves no handoff until the run ends.
		const handoffs = () => h.db.prepare("SELECT state FROM handoffs").all();
		expect(handoffs()).toEqual([]);
		expect(h.timers.map((t) => t.ms)).toEqual([30_000]);
		h.clock.now = T0 + 30_000;
		h.timers[0]?.fn();
		await settled(h, runId, "completed");
		expect(handoffs()).toEqual([{ state: "open" }]);
	});

	it("leaves a quota-paused run alone at the reset when another process cancelled it", async () => {
		const resumesAt = new Date(T0 + 60_000).toISOString();
		const quota: LlmChunk[] = [
			{
				type: "error",
				error: { code: "quota_exhausted", message: "q", resumesAt },
			},
		];
		const h = engineHarness({ scripts: [quota, reply("done")] });
		const runId = await begin(h);
		await settled(h, runId, "paused");
		const other = engineHarness({ scripts: [], db: h.db });
		expect((await other.engine.cancel(runId)).ok).toBe(true);
		h.timers[0]?.fn();
		expect(view(h, runId)?.status).toBe("cancelled");
		expect(h.requests).toHaveLength(1);
	});

	it("cancels a running run and aborts its model call (the kill switch, ADR-065)", async () => {
		const h = engineHarness({ scripts: [slow] });
		const runId = await begin(h);
		await vi.waitFor(() => expect(h.requests).toHaveLength(1));
		expect((await h.engine.cancel(runId)).ok).toBe(true);
		await settled(h, runId, "cancelled");
		expect(view(h, runId)?.endedAt).toBeDefined();
		await h.stop();
		expect(view(h, runId)?.status).toBe("cancelled");
		expect(typesOf(h.events)).toContain("run.cancelled");
		expect(h.requests).toHaveLength(1);
	});

	it("never lets the model reach checkpoint operations through vcs_git", async () => {
		const vcs = vi.fn(async () => ok({ op: "checkpoint.restore", ref: "x" }));
		const h = engineHarness({
			scripts: [
				reply("", [
					{
						name: "vcs_git",
						args: {
							op: "checkpoint.restore",
							ref: "refs/mete/checkpoints/r/1",
						},
					},
				]),
				reply("ok"),
			],
			tools: [["vcs.git@2", vcs]],
		});
		const runId = await begin(h);
		await settled(h, runId, "completed");
		expect(vcs).not.toHaveBeenCalled();
		expect(
			JSON.parse(String(h.requests[1]?.messages.at(-1)?.content)),
		).toMatchObject({ ok: false, error: { code: "bad_input" } });
	});

	it("leaves a handoff at an approval pause that names failures and files, never tool output", async () => {
		const read = vi.fn<Tool>(async () => ok({ content: "MARKER-OUTPUT" }));
		const edit = vi.fn<Tool>(async () =>
			err({ code: "match_count", message: "MARKER-ERROR" }),
		);
		const write = vi.fn<Tool>(async () =>
			err({ code: "approval_required", rule: "autonomy:1", message: "ask" }),
		);
		const h = engineHarness({
			scripts: [
				reply("", [{ name: "fs_read", args: { path: "a.md" } }]),
				reply("", [
					{ name: "fs_edit", args: { path: "b.md", oldStr: "x", newStr: "y" } },
				]),
				reply("", [
					{
						name: "fs_write",
						args: { path: "c.md", content: "MARKER-CONTENT" },
					},
				]),
			],
			tools: [
				["fs.read@1", read],
				["fs.edit@1", edit],
				["fs.write@1", write],
			],
		});
		const runId = await begin(h);
		await settled(h, runId, "paused");
		const rows = h.db
			.prepare("SELECT run_id, state, body FROM handoffs")
			.all() as {
			run_id: string;
			state: string;
			body: string;
		}[];
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ run_id: runId, state: "open" });
		expect(rows[0]?.body).toBe(
			[
				"# Handoff",
				"Goal: rename foo to bar",
				"Stopped: paused (approval)",
				"Open question: paused for approval",
				"Failed tool calls:",
				"- fs_edit: match_count",
				"Files changed:",
				"- b.md",
				"- c.md",
			].join("\n"),
		);
		expect(rows[0]?.body).not.toMatch(/MARKER/);
	});

	it("offers the next run the open handoff in one line, never its body", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		await settled(h, await begin(h, "first goal"), "completed");
		await settled(h, await begin(h, "second goal"), "completed");
		const user = String(h.requests[1]?.messages[1]?.content);
		expect(user).toMatch(/^<start-brief> /);
		expect(user).toMatch(
			/left handoff \S+ \(just now\) for the goal "first goal"/,
		);
		expect(user).not.toContain("Stopped:");
		expect(user.endsWith("second goal")).toBe(true);
	});

	it("continues from the newest open handoff once, with its goal and body", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		expect(await h.engine.start({ continue: true })).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
		const first = await begin(h, "first goal");
		await settled(h, first, "completed");
		const next = await h.engine.start({ continue: true });
		if (!next.ok) throw new Error(next.error.message);
		await settled(h, next.value.runId, "completed");
		expect(view(h, next.value.runId)?.goal).toBe("first goal");
		const user = String(h.requests[1]?.messages[1]?.content);
		expect(user).toContain("Goal: first goal\nStopped: completed");
		const taken = h.db
			.prepare(
				"SELECT state, accepted_by_run_id AS by FROM handoffs WHERE run_id = ?",
			)
			.get(first);
		expect(taken).toEqual({ state: "accepted", by: next.value.runId });
	});

	it("summarizes older turns on the fast tier once the conversation passes 70% of the window", async () => {
		const read = vi.fn<Tool>(async () => ok({ content: "z".repeat(100_000) }));
		const h = engineHarness({
			scripts: [
				reply("", [{ name: "fs_read", args: { path: "big.log" } }]),
				reply("big.log is a long build log; the error is on line 12"),
				reply("done"),
			],
			tools: [["fs.read@1", read]],
		});
		const runId = await begin(h);
		await settled(h, runId, "completed");
		const [, summary, after] = h.requests;
		expect(summary?.target).toEqual({ tier: "fast" });
		expect(summary?.tools).toBeUndefined();
		const sent = JSON.stringify(after?.messages);
		expect(sent).toContain("<summary> Earlier turns");
		expect(sent).not.toContain("zzzz");
		const done = h.events.find((e) => e.type === "run.summarized");
		expect(done?.payload).toEqual({ messages: 2, chars: 52 });
	});

	it("summarizes the older turns once and asks again when a request is too large for every model", async () => {
		const read = vi.fn<Tool>(async () => ok({ content: "small" }));
		const call = reply("", [{ name: "fs_read", args: { path: "a.txt" } }]);
		const tooLarge: LlmChunk[] = [
			{ type: "error", error: { code: "too_large", message: "8400 > 8000" } },
		];
		const h = engineHarness({
			scripts: [
				call,
				call,
				call,
				call,
				call,
				tooLarge,
				reply("summary"),
				reply("done"),
			],
			tools: [["fs.read@1", read]],
		});
		const runId = await begin(h);
		await settled(h, runId, "completed");
		expect(h.events.filter((e) => e.type === "run.summarized")).toHaveLength(1);
		expect(h.events.some((e) => e.type === "run.paused")).toBe(false);
		expect(h.requests.at(-2)?.target).toEqual({ tier: "fast" });
	});

	it("pauses with no_model when the request is still too large after its one summary", async () => {
		const read = vi.fn<Tool>(async () => ok({ content: "small" }));
		const call = reply("", [{ name: "fs_read", args: { path: "a.txt" } }]);
		const tooLarge: LlmChunk[] = [
			{ type: "error", error: { code: "too_large", message: "m" } },
		];
		const h = engineHarness({
			scripts: [
				call,
				call,
				call,
				call,
				call,
				tooLarge,
				reply("summary"),
				tooLarge,
			],
			tools: [["fs.read@1", read]],
		});
		const runId = await begin(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("no_model");
		expect(h.events.filter((e) => e.type === "run.summarized")).toHaveLength(1);
	});

	it("pauses with no_model when a too large request has no older turns to fold", async () => {
		const h = engineHarness({
			scripts: [
				[{ type: "error", error: { code: "too_large", message: "m" } }],
				reply("done"),
			],
		});
		const runId = await begin(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("no_model");
		expect(h.events.some((e) => e.type === "run.summarized")).toBe(false);
	});

	it("summarizes once when the newest turns alone fill the window, never the summary again", async () => {
		const read = vi.fn<Tool>(async () => ok({ content: "z".repeat(25_000) }));
		const call = reply("", [{ name: "fs_read", args: { path: "big.log" } }]);
		const h = engineHarness({
			scripts: [
				call,
				call,
				call,
				call,
				call,
				reply("the first read"),
				reply("done"),
			],
			tools: [["fs.read@1", read]],
		});
		const runId = await begin(h);
		await settled(h, runId, "completed");
		const fast = h.requests.filter(
			(r) => "tier" in r.target && r.target.tier === "fast",
		);
		expect(fast).toHaveLength(1);
		expect(h.requests).toHaveLength(7);
	});

	it("pauses for approval and repeats the same tool call on resume", async () => {
		const shell = vi
			.fn()
			.mockResolvedValueOnce(
				err({ code: "approval_required", rule: "autonomy:1", message: "ask" }),
			)
			.mockResolvedValue(
				ok({
					exitCode: 0,
					stdout: "",
					stderr: "",
					os: "x",
					shell: "sh",
					timedOut: false,
				}),
			);
		const h = engineHarness({
			scripts: [
				reply("", [{ name: "shell_exec", args: { command: "pnpm test" } }]),
				reply("tests pass"),
			],
			tools: [["shell.exec@1", shell]],
		});
		const runId = await begin(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("approval");
		expect((await h.engine.resume(runId)).ok).toBe(true);
		await settled(h, runId, "completed");
		expect(shell).toHaveBeenCalledTimes(2);
		expect(h.requests).toHaveLength(2);
	});

	it("returns a denied tool call to the model as its result", async () => {
		const write = vi.fn(async () =>
			err({ code: "denied", rule: "protected_path", message: "no" }),
		);
		const h = engineHarness({
			scripts: [
				reply("", [
					{
						name: "fs_write",
						args: { path: ".mete/policy.yaml", content: "x" },
					},
				]),
				reply("cannot"),
			],
			tools: [["fs.write@1", write]],
		});
		const runId = await begin(h);
		await settled(h, runId, "completed");
		expect(String(h.requests[1]?.messages.at(-1)?.content)).toContain(
			"protected_path",
		);
	});

	it("keeps a tool call that finishes after a pause and never runs it twice", async () => {
		let finish: (() => void) | undefined;
		const shell = vi.fn<Tool>(
			() =>
				new Promise((resolve) => {
					finish = () =>
						resolve(
							ok({
								exitCode: 0,
								stdout: "1",
								stderr: "",
								os: "x",
								shell: "sh",
								timedOut: false,
							}),
						);
				}),
		);
		const h = engineHarness({
			scripts: [
				reply("", [{ name: "shell_exec", args: { command: "echo 1" } }]),
				reply("done"),
			],
			tools: [["shell.exec@1", shell]],
		});
		const runId = await begin(h);
		await vi.waitFor(() => expect(shell).toHaveBeenCalled());
		expect((await h.engine.pause(runId)).ok).toBe(true);
		expect((await h.engine.resume(runId)).ok).toBe(true);
		finish?.();
		await settled(h, runId, "completed");
		expect(shell).toHaveBeenCalledTimes(1);
		expect(h.requests).toHaveLength(2);
	});

	it("masks tool output, the summary and a failure message before the run keeps them", async () => {
		const mask = async (text: string) => ({
			text: text.replaceAll("sk-SECRET", "[SECRET:1]"),
			masked: 1,
		});
		const withMask = (h: ReturnType<typeof engineHarness>) =>
			h.registry.provide("secrets.mask@1", {
				id: "security",
				trust: "core",
				features: [],
				impl: { mask },
			});
		const h = engineHarness({
			scripts: [
				reply("", [{ name: "fs_read", args: { path: ".env" } }]),
				reply("The key is sk-SECRET."),
			],
			tools: [
				[
					"fs.read@1",
					async () =>
						ok({ content: "KEY=sk-SECRET", totalLines: 1, lineEnding: "none" }),
				],
			],
		});
		withMask(h);
		const runId = await begin(h);
		await settled(h, runId, "completed");
		const stored = h.db.prepare("SELECT snapshot FROM runs").pluck().get();
		expect(String(stored)).not.toContain("sk-SECRET");
		expect(h.events.at(-1)?.payload).toEqual({
			summary: "The key is [SECRET:1].",
		});
		const failing = engineHarness({
			scripts: [
				[
					{
						type: "error",
						error: { code: "bad_request", message: "bad key sk-SECRET" },
					},
				],
			],
		});
		withMask(failing);
		await settled(failing, await begin(failing), "failed");
		expect(failing.events.at(-1)?.payload).toMatchObject({
			message: "bad key [SECRET:1]",
		});
	});

	it("fails at the turn limit", async () => {
		const h = engineHarness({
			scripts: [reply("", [{ name: "fs_read", args: { path: "a" } }])],
			tools: [
				[
					"fs.read@1",
					async () => ok({ content: "", totalLines: 0, lineEnding: "none" }),
				],
			],
		});
		const runId = await begin(h);
		await settled(h, runId, "failed");
		expect(h.requests).toHaveLength(MAX_TURNS);
		expect(h.events.at(-1)).toMatchObject({
			type: "run.failed",
			payload: { code: "turn_limit" },
		});
	});

	it("fails a writing step whose checkpoint cannot be made", async () => {
		const edit = vi.fn<Tool>(async () => edited);
		const h = engineHarness({
			scripts: [
				reply("", [
					{ name: "fs_edit", args: { path: "a", oldStr: "x", newStr: "y" } },
				]),
			],
			tools: [
				["fs.edit@1", edit],
				[
					"vcs.git@2",
					async () => err({ code: "io", message: "index.lock exists" }),
				],
			],
		});
		const runId = await begin(h);
		await settled(h, runId, "failed");
		expect(edit).not.toHaveBeenCalled();
		expect(h.events.at(-1)?.payload).toEqual({
			code: "checkpoint_failed",
			message: "index.lock exists",
		});
	});

	it("pauses with no_model when llm.chat@2 is missing and on budget at its limit", async () => {
		const none = engineHarness({ scripts: [], llm: false });
		const a = await begin(none);
		await settled(none, a, "paused");
		expect(view(none, a)?.pauseReason).toBe("no_model");
		const tight = engineHarness({
			scripts: [reply("", [{ name: "fs_read", args: { path: "a" } }])],
			tools: [
				[
					"fs.read@1",
					async () => ok({ content: "", totalLines: 0, lineEnding: "none" }),
				],
			],
			policy: { budget: { cloud_requests_per_run: 1 } },
		});
		const b = await begin(tight);
		await settled(tight, b, "paused");
		expect(view(tight, b)).toMatchObject({
			pauseReason: "budget",
			budget: { cloudRequests: 1 },
		});
	});

	it("asks the model to continue after a reply cut at the token limit", async () => {
		const cut = reply("half").map((c) =>
			c.type === "finish" ? { ...c, reason: "length" as const } : c,
		);
		const h = engineHarness({ scripts: [cut, reply("whole")] });
		const runId = await begin(h);
		await settled(h, runId, "completed");
		expect(h.requests[1]?.messages.at(-1)?.role).toBe("user");
		expect(h.events.at(-1)?.payload).toEqual({ summary: "whole" });
	});

	it("records a model change and fails a run whose tool adapter throws", async () => {
		const h = engineHarness({
			scripts: [
				reply("", [{ name: "fs_read", args: { path: "a" } }]),
				reply("x", [], "m2"),
			],
			tools: [
				[
					"fs.read@1",
					async () => {
						throw new TypeError("secret detail");
					},
				],
			],
		});
		const runId = await begin(h);
		await settled(h, runId, "failed");
		expect(h.events.at(-1)?.payload).toEqual({
			code: "internal",
			message: "TypeError",
		});
		const h2 = engineHarness({
			scripts: [reply("", [{ name: "nope", args: {} }]), reply("x", [], "m2")],
		});
		const r2 = await begin(h2);
		await settled(h2, r2, "completed");
		expect(
			h2.events.find((e) => e.type === "agent.model.changed")?.payload,
		).toEqual({
			from: { providerId: "p", modelId: "m1" },
			to: { providerId: "p", modelId: "m2" },
			reason: "first",
		});
	});

	it("pauses runs an earlier process left running, and running runs on stop", async () => {
		const h = engineHarness({ scripts: [slow] });
		const runId = await begin(h);
		await h.stop();
		expect(view(h, runId)).toMatchObject({
			status: "paused",
			pauseReason: "user",
		});
		const crashed = engineHarness({ scripts: [slow] });
		const lost = await begin(crashed);
		await vi.waitFor(() => expect(crashed.requests).toHaveLength(1));
		const later = engineHarness({ scripts: [slow], db: crashed.db });
		later.recover();
		expect(view(later, lost)).toMatchObject({
			status: "paused",
			pauseReason: "user",
		});
		expect(typesOf(later.events)).toEqual(["run.paused"]);
		expect((await later.engine.resume(lost)).ok).toBe(true);
		await vi.waitFor(() => expect(later.requests).toHaveLength(1));
		await crashed.stop();
		await later.stop();
	});

	it("skips a damaged row on recovery and keeps the others", async () => {
		const crashed = engineHarness({ scripts: [slow] });
		const kept = await begin(crashed);
		await vi.waitFor(() => expect(crashed.requests).toHaveLength(1));
		const row = crashed.db.prepare("SELECT * FROM runs").get();
		crashed.db
			.prepare(
				"INSERT INTO runs SELECT ?, workspace_id, template_id, goal, status, pause_reason, autonomy_level, budget_cloud_requests, budget_max_hours, '{}', created_at, started_at, ended_at FROM runs",
			)
			.run(crypto.randomUUID());
		expect(row).toBeDefined();
		const later = engineHarness({ scripts: [slow], db: crashed.db });
		expect(() => later.recover()).not.toThrow();
		expect(view(later, kept)).toMatchObject({
			status: "paused",
			pauseReason: "user",
		});
		await crashed.stop();
	});

	it("marks a damaged row failed on recovery and answers not_found for it", async () => {
		const h = engineHarness({ scripts: [slow] });
		const runId = await begin(h);
		await vi.waitFor(() => expect(h.requests).toHaveLength(1));
		h.db.prepare("UPDATE runs SET snapshot = '{}'").run();
		const later = engineHarness({ scripts: [slow], db: h.db });
		for (const r of [
			await later.engine.resume(runId),
			await later.engine.cancel(runId),
		])
			expect(r.ok ? "ok" : r.error.code).toBe("not_found");
		later.recover();
		expect(view(later, runId)?.status).toBe("failed");
		await h.stop();
	});

	it("pauses a run an earlier process left queued", async () => {
		let saves = 0;
		const crashed = engineHarness({
			scripts: [slow],
			wrapStore: (store) => ({
				...store,
				save: (meta, snap) => {
					if (++saves === 2) throw new Error("crash");
					store.save(meta, snap);
				},
			}),
		});
		await expect(crashed.engine.start({ goal: "g" })).rejects.toThrow("crash");
		const [row] = crashed.store.list();
		expect(row?.status).toBe("queued");
		const later = engineHarness({ scripts: [slow], db: crashed.db });
		later.recover();
		expect(view(later, row?.id ?? "")).toMatchObject({
			status: "paused",
			pauseReason: "user",
		});
	});

	it("logs a resume that throws when a pause ended instead of rejecting", async () => {
		const resumesAt = new Date(T0 + 60_000).toISOString();
		const quota: LlmChunk[] = [
			{
				type: "error",
				error: { code: "quota_exhausted", message: "q", resumesAt },
			},
		];
		let broken = false;
		const h = engineHarness({
			scripts: [quota],
			wrapStore: (store) => ({
				...store,
				save: (meta, snap) => {
					if (broken) throw new Error("SQLITE_BUSY");
					store.save(meta, snap);
				},
			}),
		});
		const runId = await begin(h);
		await settled(h, runId, "paused");
		broken = true;
		const rejected = vi.fn();
		process.once("unhandledRejection", rejected);
		h.timers[0]?.fn();
		await new Promise((r) => setTimeout(r, 20));
		process.off("unhandledRejection", rejected);
		expect(rejected).not.toHaveBeenCalled();
		expect(
			h.logged.some((l) => l.msg === "run not resumed when its pause ended"),
		).toBe(true);
	});

	it("survives a run row that cannot be written and goes on after pause and resume", async () => {
		let saves = 0;
		const h = engineHarness({
			scripts: [reply("", [{ name: "nope", args: {} }]), reply("done")],
			wrapStore: (store) => ({
				...store,
				save: (meta, snap) => {
					saves++;
					if (saves === 3 || saves === 4) throw new Error("SQLITE_BUSY");
					store.save(meta, snap);
				},
			}),
		});
		const runId = await begin(h);
		await vi.waitFor(() => expect(saves).toBeGreaterThanOrEqual(4));
		expect(view(h, runId)?.status).toBe("running");
		expect((await h.engine.pause(runId)).ok).toBe(true);
		expect((await h.engine.resume(runId)).ok).toBe(true);
		await settled(h, runId, "completed");
	});
});
