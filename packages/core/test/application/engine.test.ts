import type { RunView } from "@mete/contracts";
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
				["vcs.git@1", vcs],
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
		expect(h.timers.map((t) => t.ms)).toEqual([60_000]);
		h.clock.now = T0 + 60_000;
		h.timers[0]?.fn();
		await settled(h, runId, "completed");
		expect(typesOf(h.events).filter((t) => t.startsWith("run."))).toEqual([
			"run.created",
			"run.started",
			"run.paused",
			"run.resumed",
			"run.completed",
		]);
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
			tools: [["vcs.git@1", vcs]],
		});
		const runId = await begin(h);
		await settled(h, runId, "completed");
		expect(vcs).not.toHaveBeenCalled();
		expect(
			JSON.parse(String(h.requests[1]?.messages.at(-1)?.content)),
		).toMatchObject({ ok: false, error: { code: "bad_input" } });
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
					"vcs.git@1",
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

	it("pauses with no_model when llm.chat@1 is missing and on budget at its limit", async () => {
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
});
