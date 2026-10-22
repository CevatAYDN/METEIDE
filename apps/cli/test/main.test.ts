import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MeteEvent, RunView } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { endOf } from "../src/application/commands.js";
import { eventLine, exitCode, statusLines } from "../src/domain/format.js";
import { fileLogger, moduleLogger } from "../src/infrastructure/log.js";
import { runLockFile, takeRunLock } from "../src/infrastructure/run-lock.js";
import { main } from "../src/main.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

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
		for (const argv of [["dance"], ["run"], ["stop"], ["--nope"]]) {
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
		expect(keys.out).toHaveLength(4); // the three model providers and tavily
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
			expect(t.err[0]).toContain(`another mete run (pid ${process.pid})`);
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
