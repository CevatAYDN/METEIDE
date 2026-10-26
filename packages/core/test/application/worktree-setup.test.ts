import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type RunView, type ToolError } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	runWorktreeSetup,
	worktreeSetupCommand,
} from "../../src/application/vcs-steps.js";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply, type Tool } from "../helpers/engine.js";

const BUILDER = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [fs.*@1] }
tasks:
  - { id: build, role: dev, title: Build }
`;

const fakeVcs = (path = "/mock/wt") => {
	const calls: { op: string; cwd?: string }[] = [];
	const run: Tool = async (input, ctx) => {
		const i = input as { op: string };
		calls.push({ op: i.op, ...(ctx.cwd ? { cwd: ctx.cwd } : {}) });
		if (i.op === "worktree.create")
			return ok({ op: "worktree.create", path, branch: "mete/r/t", sha: "s" });
		if (i.op === "merge") return ok({ op: "merge", sha: "m" });
		if (i.op === "worktree.remove")
			return ok({ op: "worktree.remove", removed: true });
		return ok({
			op: "checkpoint.create",
			ref: "refs/mete/checkpoints/r/1",
			sha: "s",
		});
	};
	return { calls, run };
};

const shellResult = (exitCode: number | null, stderr = "", timedOut = false) =>
	ok({
		exitCode,
		stdout: "done",
		stderr,
		os: "linux",
		shell: "sh",
		timedOut,
	});

let root: string;
let templates: TemplateDirs;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-wt-setup-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	await writeFile(join(templates.builtIn, "duo.yaml"), BUILDER);
});

afterEach(() => rm(root, { recursive: true, force: true }));

type H = ReturnType<typeof engineHarness>;
const view = (h: H, runId: string): RunView | undefined => {
	const r = h.engine.status(runId);
	return r.ok ? r.value[0] : undefined;
};
const settled = (h: H, runId: string, status: string) =>
	vi.waitFor(() => expect(view(h, runId)?.status).toBe(status));
const start = async (h: H, templateId = "duo") => {
	const r = await h.engine.start({ goal: "g", templateId });
	if (!r.ok) throw new Error(r.error.message);
	return r.value.runId;
};

describe("worktree setup command execution (ADR-123)", () => {
	it("runs setup command in cwd: worktree when configured in worktrees section", async () => {
		const vcs = fakeVcs("/mock/wt");
		const commands: {
			input: unknown;
			cwd?: string | undefined;
			runId?: string | undefined;
		}[] = [];
		const shell: Tool = async (input, ctx) => {
			commands.push({ input, cwd: ctx.cwd, runId: ctx.runId });
			return shellResult(0);
		};
		const h = engineHarness({
			scripts: [reply("built")],
			tools: [
				["vcs.git@2", vcs.run],
				["shell.exec@1", shell],
			],
			worktrees: { setup: "pnpm install" },
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");

		expect(commands).toHaveLength(1);
		expect(commands[0]?.input).toEqual({ command: "pnpm install" });
		expect(commands[0]?.cwd).toBe("/mock/wt");
		expect(commands[0]?.runId).toBe(runId);

		const toolEvents = h.events.filter(
			(e) =>
				e.type === "agent.tool.called" || e.type === "agent.tool.completed",
		);
		expect(toolEvents.length).toBeGreaterThanOrEqual(2);
		expect(toolEvents[0]?.payload).toMatchObject({
			capability: "shell.exec@1",
		});
	});

	it("falls back to singular worktree section when worktrees is absent", async () => {
		const vcs = fakeVcs("/mock/wt");
		const commands: { input: unknown; cwd?: string | undefined }[] = [];
		const shell: Tool = async (input, ctx) => {
			commands.push({ input, cwd: ctx.cwd });
			return shellResult(0);
		};
		const h = engineHarness({
			scripts: [reply("built")],
			tools: [
				["vcs.git@2", vcs.run],
				["shell.exec@1", shell],
			],
			worktree: { setup: "npm test" },
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");

		expect(commands).toHaveLength(1);
		expect(commands[0]?.input).toEqual({ command: "npm test" });
		expect(commands[0]?.cwd).toBe("/mock/wt");
	});

	it("pauses the run for approval when policy returns approval_required", async () => {
		const vcs = fakeVcs("/mock/wt");
		let asked = false;
		const shell: Tool = async () => {
			if (!asked) {
				asked = true;
				return err<ToolError>({
					code: "approval_required",
					rule: "shell.exec",
					message: "ask",
				});
			}
			return shellResult(0);
		};
		const h = engineHarness({
			scripts: [reply("built")],
			tools: [
				["vcs.git@2", vcs.run],
				["shell.exec@1", shell],
			],
			worktrees: { setup: "pnpm install" },
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "paused");
		expect(view(h, runId)?.status).toBe("paused");

		const pauseEvent = h.events.find((e) => e.type === "run.paused");
		expect(pauseEvent?.payload).toMatchObject({ reason: "approval" });

		// Resuming allows setup to run and the run to complete
		await h.engine.resume(runId);
		await settled(h, runId, "completed");
	});

	it("gracefully continues and logs warning when setup command fails with non-zero exit code", async () => {
		const vcs = fakeVcs("/mock/wt");
		const shell: Tool = async () => shellResult(1, "ERR_INSTALL_FAILED");
		const h = engineHarness({
			scripts: [reply("built")],
			tools: [
				["vcs.git@2", vcs.run],
				["shell.exec@1", shell],
			],
			worktrees: { setup: "pnpm install" },
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");

		const warned = h.logged.find((l) =>
			l.msg.includes("worktree setup command failed"),
		);
		expect(warned).toBeDefined();
		expect(warned?.level).toBe("warn");
	});

	it("gracefully continues and logs warning when setup command returns an error", async () => {
		const vcs = fakeVcs("/mock/wt");
		const shell: Tool = async () =>
			err<ToolError>({ code: "io", message: "spawn error" });
		const h = engineHarness({
			scripts: [reply("built")],
			tools: [
				["vcs.git@2", vcs.run],
				["shell.exec@1", shell],
			],
			worktrees: { setup: "pnpm install" },
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");

		const warned = h.logged.find((l) =>
			l.msg.includes("worktree setup command failed"),
		);
		expect(warned).toBeDefined();
	});

	it("does not run setup command when setup is absent or undefined", async () => {
		const vcs = fakeVcs("/mock/wt");
		let shellCalled = false;
		const shell: Tool = async () => {
			shellCalled = true;
			return shellResult(0);
		};
		const h = engineHarness({
			scripts: [reply("built")],
			tools: [
				["vcs.git@2", vcs.run],
				["shell.exec@1", shell],
			],
			templates,
		});
		const runId = await start(h);
		await settled(h, runId, "completed");

		expect(shellCalled).toBe(false);
	});
});

describe("worktreeSetupCommand unit tests", () => {
	it("returns undefined when neither worktrees nor worktree section is present", () => {
		const deps = {
			config: { get: () => ok({}) },
		} as unknown as Parameters<typeof worktreeSetupCommand>[0];
		expect(worktreeSetupCommand(deps)).toBeUndefined();
	});

	it("prioritizes worktrees plural section over worktree singular", () => {
		const deps = {
			config: {
				get: (k: string) =>
					k === "worktrees"
						? ok({ setup: "pnpm install" })
						: ok({ setup: "npm install" }),
			},
		} as unknown as Parameters<typeof worktreeSetupCommand>[0];
		expect(worktreeSetupCommand(deps)).toBe("pnpm install");
	});

	it("falls back to singular worktree section when plural setup is undefined", () => {
		const deps = {
			config: {
				get: (k: string) =>
					k === "worktrees" ? ok({}) : ok({ setup: "npm install" }),
			},
		} as unknown as Parameters<typeof worktreeSetupCommand>[0];
		expect(worktreeSetupCommand(deps)).toBe("npm install");
	});
});

describe("runWorktreeSetup unit tests", () => {
	it("handles timedOut process and logs warning without throwing", async () => {
		const warned: { fields: unknown; msg: string }[] = [];
		const deps = {
			config: { get: () => ok({ setup: "pnpm install" }) },
			registry: {
				resolve: () =>
					ok([
						{
							id: "fake-shell",
							impl: { run: async () => shellResult(null, "", true) },
						},
					]),
			},
			logger: {
				warn: (fields: unknown, msg: string) => warned.push({ fields, msg }),
			},
			now: () => 100,
		} as unknown as Parameters<typeof runWorktreeSetup>[0];

		const target = {
			worktree: "/mock/wt",
			runId: "r1",
			taskId: "t1",
			agentId: "a1",
		};
		const res = await runWorktreeSetup(
			deps,
			target,
			new AbortController().signal,
			() => {},
		);
		expect(res).toBe("ok");
		expect(warned).toHaveLength(1);
		expect(warned[0]?.msg).toBe(
			"worktree setup command failed; continuing task",
		);
		expect(warned[0]?.fields).toMatchObject({
			command: "pnpm install",
			reason: "timed out",
		});
	});
});
