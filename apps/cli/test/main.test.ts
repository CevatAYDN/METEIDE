import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MeteEvent, RunView } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { endOf } from "../src/application/commands.js";
import { ADAPTERS_DIR_ENV, TEMPLATES_DIR_ENV } from "../src/defaults.js";
import { eventLine, exitCode, statusLines } from "../src/domain/format.js";
import { fileLogger, moduleLogger } from "../src/infrastructure/log.js";
import { runLockFile, takeRunLock } from "../src/infrastructure/run-lock.js";
import { foldersOf, main } from "../src/main.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

/** What the scripted chat answers instead of a provider (docs/15; ADR-111). */
const CHAT = [
	[
		{ type: "text", text: "hello" },
		{
			type: "finish",
			reason: "stop",
			usage: { prompt: 1, completion: 1 },
		},
	],
];

/** One valid template, for a packaged templates folder (ADR-115). */
const PROBE = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: probe, name: Probe, version: 1.0.0 }
pattern: single
roles:
  - { id: writer, name: Writer, goal: Write a note, tier: fast, capabilities: [] }
tasks:
  - { id: notes, role: writer, title: Take notes }
`;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const event = (type: string, payload: unknown): MeteEvent =>
	({
		id: randomUUID(),
		ts: "2026-10-21T10:00:00.000Z",
		schema: 1,
		workspaceId: randomUUID(),
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

describe("mete main", () => {
	it("prints usage for --help, and as an error for a bad command or option", async () => {
		const help = recordingIo();
		expect(await main(["--help"], help.io, { cwd: ".", logger: silent })).toBe(
			0,
		);
		expect(help.out[0]).toMatch(/^usage:/);
		const allowBoth = ["allow", "r", "--run", "--always"];
		for (const argv of [
			["dance"],
			["run"],
			["stop"],
			["--nope"],
			["allow"],
			allowBoth,
		]) {
			const t = recordingIo();
			expect(await main(argv, t.io, { cwd: ".", logger: silent })).toBe(1);
			expect(t.err.join("\n")).toContain("usage:");
		}
	});

	it("runs status in a workspace whose providers have no key, with no real keychain", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const t = recordingIo();
		const env = {
			cwd: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
		};
		expect(await main(["status"], t.io, env)).toBe(1);
		expect(t.err).toContain(
			"provider-openrouter is not active (activation_failed)",
		);
		const keys = recordingIo();
		expect(await main(["key", "list"], keys.io, env)).toBe(0);
		expect(keys.out).toHaveLength(6); // the five model providers and tavily
	});

	it("runs status on a scripted chat instead of the providers when one is named (docs/15, ADR-111)", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const script = join(repo.workspaceDir, "chat.json");
		await writeFile(script, JSON.stringify(CHAT));
		const t = recordingIo();
		const code = await main(["status"], t.io, {
			cwd: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			scriptedChat: script,
		});
		expect(code).toBe(0);
		expect(t.err).toEqual([]);
		expect(t.out).toEqual(["no runs"]);
	});

	it("takes the packaged folders from an Env value first, then the environment (ADR-115)", () => {
		const read = (name: string) =>
			({
				[ADAPTERS_DIR_ENV]: "/env/adapters",
				[TEMPLATES_DIR_ENV]: "/env/templates",
			})[name];
		expect(foldersOf({}, read)).toEqual({
			templatesDir: "/env/templates",
			adaptersDir: "/env/adapters",
		});
		expect(foldersOf({ templatesDir: "/mine" }, read)).toEqual({
			templatesDir: "/mine",
			adaptersDir: "/env/adapters",
		});
		expect(foldersOf({}, () => undefined)).toEqual({
			templatesDir: undefined,
			adaptersDir: undefined,
		});
	});

	it("validates a template from the packaged folder an Env value or the environment names (ADR-115)", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const teams = join(repo.globalDir, "templates");
		await mkdir(teams, { recursive: true });
		await writeFile(join(teams, "probe.yaml"), PROBE);
		const env = {
			cwd: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
		};
		const explicit = recordingIo();
		expect(
			await main(["template", "validate", "probe"], explicit.io, {
				...env,
				templatesDir: teams,
			}),
		).toBe(0);
		expect(explicit.out).toEqual(["probe  ok"]);
		process.env[TEMPLATES_DIR_ENV] = teams;
		try {
			const fromEnv = recordingIo();
			expect(
				await main(["template", "validate", "probe"], fromEnv.io, env),
			).toBe(0);
			expect(fromEnv.out).toEqual(["probe  ok"]);
		} finally {
			delete process.env[TEMPLATES_DIR_ENV];
		}
	});

	it("refuses run and stop while another mete run holds the workspace", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const lock = await takeRunLock(runLockFile(repo.workspaceDir));
		if (!lock.ok) throw new Error(lock.error);
		const env = {
			cwd: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
		};
		for (const argv of [
			["run", "g"],
			["stop", "--all"],
		]) {
			const t = recordingIo();
			expect(await main(argv, t.io, env)).toBe(1);
			expect(t.err[0]).toContain(`another mete command (pid ${process.pid}:`);
		}
		await lock.value();
	});

	it("writes JSON log lines with the module id into the day's file", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const log = moduleLogger(
			fileLogger(repo.globalDir, Date.parse("2026-10-21T08:00:00Z")),
			"gateway",
		);
		log.warn({ runId: "r" }, "slow");
		const [file] = await readdir(join(repo.globalDir, "logs"));
		expect(file).toBe("mete-2026-10-21.log");
		const line = JSON.parse(
			await readFile(join(repo.globalDir, "logs", file ?? ""), "utf8"),
		);
		expect(line).toMatchObject({ module: "gateway", runId: "r", msg: "slow" });
	});
});

describe("output lines", () => {
	it("shows model changes, pauses, failures and resumes", () => {
		const m = (modelId: string) => ({ providerId: "p", modelId });
		expect(
			eventLine(
				event("agent.model.changed", {
					from: m("a"),
					to: m("b"),
					reason: "quota",
				}),
			),
		).toBe("model p/a -> p/b (quota)");
		expect(
			eventLine(
				event("run.paused", {
					reason: "quota",
					resumesAt: "2026-10-22T00:00:00.000Z",
				}),
			),
		).toBe("paused: quota until 2026-10-22T00:00:00.000Z");
		expect(
			eventLine(event("run.failed", { code: "turn_limit", message: "" })),
		).toBe("failed: turn_limit");
		expect(eventLine(event("run.resumed", {}))).toBe("resumed");
		expect(
			eventLine(
				event("task.merge.failed", {
					code: "merge_conflict",
					message: "merging a.txt conflicts with the workspace",
					branch: "mete/r/t",
					paths: ["a.txt"],
				}),
			),
		).toBe(
			"task  : merge failed (merging a.txt conflicts with the workspace); the branch mete/r/t and its worktree are kept, so fix the cause and approve the task to merge again",
		);
		expect(
			eventLine(
				event("agent.tool.completed", {
					capability: "fs.read@1",
					ok: false,
					durationMs: 3.4,
				}),
			),
		).toBe("      failed in 3 ms");
		expect(
			eventLine(event("module.activated", { moduleId: "x" })),
		).toBeUndefined();
	});

	it("shows a pair review: the ask, the return with its feedback and the pass (ADR-136)", () => {
		const by = { reviewerRoleId: "editor" };
		const title = () => "Write";
		expect(eventLine(event("review.requested", by), title)).toBe(
			"review by editor: Write",
		);
		expect(
			eventLine(
				event("review.completed", {
					...by,
					decision: "revise",
					feedback: "cite",
				}),
				title,
			),
		).toBe("editor asked for changes: Write (cite)");
		expect(
			eventLine(
				event("review.completed", { ...by, decision: "approve" }),
				title,
			),
		).toBe("editor reviewed, no changes: Write");
	});

	it("shows the questions a task asks before its work, one per line, and a role's answer (ADR-142)", () => {
		const title = () => "Write";
		expect(
			eventLine(
				event("task.clarification.requested", {
					toRoleId: "human",
					question: "Which city?\nWhich prices?",
				}),
				title,
			),
		).toBe(
			"Write asks human before starting:\n      Which city?\n      Which prices?",
		);
		const message = (kind: string) =>
			event("agent.message.sent", {
				messageId: crypto.randomUUID(),
				from: "a",
				to: "b",
				kind,
				summary: "Ankara.",
			});
		expect(eventLine(message("answer"), title)).toBe(
			"answered before Write: Ankara.",
		);
		expect(eventLine(message("handoff"), title)).toBeUndefined();
	});

	it("names what a policy ask is about: the command, the path, or else the capability (ADR-121)", () => {
		const ask = {
			action: "shell.exec",
			capability: "shell.exec@1",
			adapterId: "tools-shell",
			rule: "autonomy:1",
		};
		expect(
			eventLine(event("policy.asked", { ...ask, command: "node --version" })),
		).toBe("asks  shell.exec: node --version");
		expect(
			eventLine(
				event("policy.asked", {
					...ask,
					action: "fs.write.outside",
					capability: "fs.write@1",
					path: "/tmp/a.txt",
				}),
			),
		).toBe("asks  fs.write.outside: /tmp/a.txt");
		expect(
			eventLine(
				event("policy.asked", {
					...ask,
					action: "mcp.call",
					capability: "mcp.tools@1",
				}),
			),
		).toBe("asks  mcp.call: mcp.tools@1");
	});

	it("keeps following a run that waits on its own, and stops at a pause only a person clears", () => {
		const paused = (reason: string) => endOf(event("run.paused", { reason }));
		expect(paused("quota")).toBeUndefined();
		expect(paused("network")).toBeUndefined();
		for (const reason of ["approval", "no_model", "budget", "user"])
			expect(paused(reason), reason).toBe("paused");
		expect(endOf(event("run.completed", { summary: "" }))).toBe("completed");
	});

	it("maps end states to exit codes and lists runs", () => {
		expect([
			exitCode("completed"),
			exitCode("failed"),
			exitCode("cancelled"),
			exitCode("paused"),
		]).toEqual([0, 1, 1, 2]);
		expect(statusLines([])).toEqual(["no runs"]);
		const run = {
			id: "r",
			status: "paused",
			pauseReason: "budget",
			goal: "g",
		} as RunView;
		expect(statusLines([run])[0]).toBe("r  paused(budget)    g");
	});
});
