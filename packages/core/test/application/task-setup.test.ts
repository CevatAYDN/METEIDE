import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	err,
	ok,
	type PolicyRequest,
	type PolicyRequestsAdapter,
	ShellExecInputSchema,
	type ToolContext,
	VcsGitInputSchema,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	engineHarness,
	reply,
	type Script,
	type Tool,
} from "../helpers/engine.js";
import { gatedReply } from "../helpers/scheduler.js";

const TEMPLATE = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: setup, name: Setup, version: 1.0.0 }
pattern: parallel_then_synthesize
roles:
  - { id: writer, name: Writer, goal: Write, tier: coder, capabilities: [fs.write@1] }
  - { id: reader, name: Reader, goal: Read, tier: fast, capabilities: [] }
tasks:
  - { id: a, role: writer, title: Task A }
  - { id: b, role: reader, title: Task B }
`;
const shellResult = (exitCode = 0) =>
	ok({
		exitCode,
		stdout: "",
		stderr: "",
		timedOut: false,
		os: "test",
		shell: "fixture",
	});
const knownResult = (result: "ok" | "nonzero" | "error") =>
	result === "error"
		? err({ code: "io", message: "known failure" })
		: shellResult(result === "nonzero" ? 1 : 0);
let root: string | undefined;
let held: ReturnType<typeof engineHarness> | undefined;
const releases: (() => void)[] = [];
afterEach(async () => {
	for (const release of releases.splice(0)) release();
	await held?.stop();
	held?.db.close();
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
	held = undefined;
});

const setupHarness = async (
	shell: Tool,
	options: {
		verify?: boolean;
		scripts?: Script[];
		port?: PolicyRequestsAdapter;
	} = {},
) => {
	root = await mkdtemp(join(tmpdir(), "mete-task-setup-"));
	const templates = { builtIn: join(root, "templates"), workspace: root };
	const worktree = join(root, "worktree");
	await mkdir(templates.builtIn);
	const template = options.verify
		? TEMPLATE.replace(
				"title: Task A }",
				"title: Task A, verify: [{ run: fixture-verify }] }",
			)
		: TEMPLATE;
	await writeFile(join(templates.builtIn, "setup.yaml"), template);
	const checkpoints: string[] = [];
	const vcs: Tool = async (raw, ctx) => {
		const input = VcsGitInputSchema.parse(raw);
		if (input.op === "worktree.create") {
			await mkdir(worktree, { recursive: true });
			return ok({
				op: input.op,
				path: worktree,
				branch: "fixture",
				sha: "base",
			});
		}
		if (input.op === "checkpoint.create") {
			if (ctx.cwd) checkpoints.push(ctx.cwd);
			return ok({
				op: input.op,
				ref: `refs/mete/checkpoints/${input.runId}/1`,
				sha: "saved",
			});
		}
		return ok({ op: "merge", sha: "merged" });
	};
	held = engineHarness({
		scripts: options.scripts ?? [reply("done")],
		templates,
		worktrees: options.verify ? {} : { setup: "fixture-setup" },
		tools: [
			["vcs.git@2", vcs],
			["shell.exec@1", shell],
		],
	});
	if (options.port)
		held.registry.provide("policy.requests@1", {
			id: "security",
			trust: "core",
			features: [],
			impl: options.port,
		});
	return { h: held, worktree, checkpoints };
};
const start = async (h: ReturnType<typeof engineHarness>) => {
	const result = await h.engine.start({
		goal: "setup safely",
		templateId: "setup",
	});
	if (!result.ok) throw new Error(result.error.message);
	return result.value.runId;
};

const exactShellAsk = () => {
	let request: PolicyRequest | undefined;
	let granted = false;
	const calls: ToolContext[] = [];
	const port: PolicyRequestsAdapter = {
		pending: async () => ok({ requests: request ? [request] : [] }),
		grant: (input) => {
			if (
				!request ||
				request.runId !== input.runId ||
				request.agentId !== input.agentId ||
				request.requestId !== input.requestId
			)
				return err({ code: "not_found", message: "stale" });
			granted = true;
			request = undefined;
			return ok(undefined);
		},
		forget: () => {
			request = undefined;
			granted = false;
			return ok(undefined);
		},
	};
	const run: Tool = async (input, ctx) => {
		if (!ctx.runId || !ctx.agentId) throw new Error("identity missing");
		calls.push(ctx);
		if (granted) {
			granted = false;
			return shellResult();
		}
		request = {
			requestId: crypto.randomUUID(),
			runId: ctx.runId,
			agentId: ctx.agentId,
			ask: {
				action: "shell.exec",
				capability: "shell.exec@1",
				adapterId: "fake-shell.exec@1",
				command: ShellExecInputSchema.parse(input).command,
			},
			rule: "fixture",
		};
		return err({ code: "approval_required", message: "ask", rule: "fixture" });
	};
	return { port, run, calls };
};

const pendingRequest = async (
	h: ReturnType<typeof engineHarness>,
	runId: string,
) => {
	const pending = await h.tasks.pending({ runId });
	if (!pending.ok || !pending.value.requests[0])
		throw new Error("missing policy request");
	return pending.value.requests[0];
};

describe("durable task setup", () => {
	it("does not start setup if pause changes the token after the checkpoint event", async () => {
		let calls = 0;
		const f = await setupHarness(async () => {
			calls++;
			return shellResult();
		});
		const observer = f.h.bus.subscribe("checkpoint.created", (event) => {
			const id = event.runId;
			if (id)
				queueMicrotask(() => {
					void f.h.engine.pause(id);
				});
		});
		const runId = await start(f.h);
		await vi.waitFor(() =>
			expect(f.h.store.load(runId)?.snapshot.value).toBe("paused"),
		);
		await f.h.stop();
		observer.dispose();
		expect(calls).toBe(0);
		expect(f.h.store.load(runId)?.snapshot.context.team?.tasks.a?.setup).toBe(
			"pending",
		);
	});

	it.each(["ok", "nonzero", "error"] as const)(
		"persists identity and running after a checkpoint, then records known %s as done",
		async (result) => {
			const f = await setupHarness(async (_input, ctx) => {
				if (!ctx.runId || !ctx.cwd) throw new Error("setup identity missing");
				const entry = f.h.store.load(ctx.runId)?.snapshot.context.team?.tasks.a;
				expect(entry).toMatchObject({
					status: "in_progress",
					setup: "running",
					context: { worktree: f.worktree, agentId: ctx.agentId },
				});
				expect(entry?.session?.inFlight).toBeUndefined();
				expect(f.checkpoints).toContain(ctx.cwd);
				expect(
					f.h.events.some(
						(event) =>
							event.type === "checkpoint.created" && event.taskId === entry?.id,
					),
				).toBe(true);
				await writeFile(join(ctx.cwd, "ready.txt"), "prepared");
				return knownResult(result);
			});
			const runId = await start(f.h);
			await vi.waitFor(() =>
				expect(f.h.store.load(runId)?.snapshot.value).toBe("completed"),
			);
			expect(f.h.store.load(runId)?.snapshot.context.team?.tasks.a?.setup).toBe(
				"done",
			);
			expect(await readFile(join(f.worktree, "ready.txt"), "utf8")).toBe(
				"prepared",
			);
			expect(
				f.h.logged.some((log) =>
					log.msg.includes("worktree setup command failed"),
				),
			).toBe(result !== "ok");
		},
	);

	it("retains the legacy run-wide ask/resume path without the request port", async () => {
		let calls = 0;
		const f = await setupHarness(async () =>
			++calls === 1
				? err({ code: "approval_required", message: "ask", rule: "fixture" })
				: shellResult(),
		);
		const runId = await start(f.h);
		await vi.waitFor(() =>
			expect(f.h.store.load(runId)?.snapshot.value).toBe("paused"),
		);
		expect(f.h.store.load(runId)?.snapshot.context.team?.tasks.a?.setup).toBe(
			"pending",
		);
		expect(f.h.store.load(runId)?.snapshot.context.pause?.reason).toBe(
			"approval",
		);
		await f.h.engine.resume(runId);
		await vi.waitFor(() =>
			expect(f.h.store.load(runId)?.snapshot.value).toBe("completed"),
		);
		expect(calls).toBe(2);
	});

	it.each(["setup", "verify"] as const)(
		"retries only the answered %s stage and keeps verification exclusive",
		async (stage) => {
			const peer = gatedReply("B done");
			releases.push(peer.release);
			const ask = exactShellAsk();
			const f = await setupHarness(ask.run, {
				verify: stage === "verify",
				port: ask.port,
				scripts:
					stage === "setup"
						? [peer.script, reply("A done")]
						: [reply("A done"), peer.script],
			});
			const runId = await start(f.h);
			const context = () => f.h.store.load(runId)?.snapshot.context;
			if (stage === "verify") {
				await vi.waitFor(() => expect(f.h.requests).toHaveLength(2));
				// Verification owns the exclusive seat; the held peer must settle before the ask.
				expect(ask.calls).toEqual([]);
				expect(context()?.team?.tasks.a?.wait).toBeUndefined();
				peer.release();
			}
			await vi.waitFor(() =>
				expect(context()?.team?.tasks.a?.wait?.stage).toBe(stage),
			);
			await vi.waitFor(() =>
				expect(f.h.requests).toHaveLength(stage === "setup" ? 1 : 2),
			);
			expect(f.h.store.load(runId)?.snapshot.value).toBe(
				stage === "setup" ? "running" : "paused",
			);
			const request = await pendingRequest(f.h, runId);
			expect(request).toMatchObject({
				templateTaskId: "a",
				kind: "policy",
				agentId: ask.calls[0]?.agentId,
			});
			expect(context()?.team?.tasks.a?.session?.inFlight).toBeUndefined();
			expect(
				(
					await f.h.tasks.answer({
						runId,
						taskId: request.taskId,
						requestId: request.requestId,
						decision: "allow",
						scope: "once",
					})
				).ok,
			).toBe(true);
			if (stage === "setup") expect(ask.calls).toHaveLength(1);
			peer.release();
			await vi.waitFor(() =>
				expect(f.h.store.load(runId)?.snapshot.value).toBe("completed"),
			);
			expect(ask.calls).toHaveLength(2);
			expect(f.h.requests).toHaveLength(2);
		},
	);
});
