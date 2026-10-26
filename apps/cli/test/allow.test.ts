import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	type ChatChunk,
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonErrorDataSchema,
	DaemonRunStartResultSchema,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { runCommand } from "../src/application/commands.js";
import { daemonCommand } from "../src/application/daemon.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	type Behaviour,
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// The human answers a policy ask (ADR-121): mete allow, the terminal's question at the pause, and
// mete/run.allow, under the built-in policy, which asks for every command. The commands run for real;
// only the provider behind the gateway is scripted. Masking an ask loads secretlint the first time,
// which may take seconds, so each test may take longer than the default.

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const runs = (command: string): ChatChunk[][] => [
	[
		{ type: "tool-call", id: "c1", name: "shell_exec", args: { command } },
		finish("tool-calls"),
	],
	[{ type: "text", text: "It ran." }, finish("stop")],
];
const NODE = "node --version";
const TOKEN = `ghp_${"A1b2C3d4E5".repeat(3)}aBcDeF`;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

type Repo = Awaited<ReturnType<typeof tempRepo>>;

// One process's app on the folder; a second one on the same folder is the next mete command.
const appIn = async (repo: Repo, b: Behaviour) => {
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		// No built-in templates: these runs are single agents, so the router never asks a model.
		templatesDir: join(repo.globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider(b)],
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	return app.value;
};

const setup = async (b: Behaviour) => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	const app = await appIn(repo, b);
	close = async () => {
		await app.stop();
		await repo.close();
	};
	return { repo, app };
};

const paused = async (app: Awaited<ReturnType<typeof setup>>["app"]) => {
	const t = recordingIo();
	expect(await runCommand(app, t.io, { goal: "check node" })).toBe(2);
	return t.out[0]?.split(" ")[1] ?? "";
};

const WITH_ALWAYS =
	"Allow once (o), for this run (r), always (a) or keep it paused (Enter)? ";

describe("answering a policy ask", { timeout: 30_000 }, () => {
	it("asks in a terminal and finishes the run on an answer of once", async () => {
		const { app } = await setup({ script: runs(NODE) });
		const t = recordingIo("", ["o"]);
		expect(await runCommand(app, t.io, { goal: "check node" })).toBe(0);
		expect(t.prompts).toEqual([WITH_ALWAYS]);
		expect(t.out).toEqual(
			expect.arrayContaining([
				"paused: approval",
				`asks  shell.exec: ${NODE}`,
				"resumed",
				"completed\nIt ran.",
			]),
		);
		expect(t.err).toEqual([]);
	});

	it("leaves the run paused without a terminal, then mete allow --run finishes it", async () => {
		const { app } = await setup({ script: runs(NODE) });
		const runId = await paused(app);
		const t = recordingIo();
		expect(await runCommand(app, t.io, { allow: runId, scope: "run" })).toBe(0);
		expect(t.out.at(-1)).toBe("completed\nIt ran.");
	});

	// The flow ADR-121 is for: mete run has exited at the pause, and mete allow starts a new process
	// that reads the ask from the history, recovers the run as paused, grants and resumes it.
	it("answers in a new process, as mete allow does after mete run has exited", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = () => repo.close();
		const first = await appIn(repo, { script: runs(NODE) });
		const runId = await paused(first);
		await first.stop();
		const done: ChatChunk[] = [
			{ type: "text", text: "It ran." },
			finish("stop"),
		];
		const next = await appIn(repo, { script: [done] });
		close = async () => {
			await next.stop();
			await repo.close();
		};
		const t = recordingIo();
		expect(await runCommand(next, t.io, { allow: runId, scope: "run" })).toBe(
			0,
		);
		expect(t.out.at(-1)).toBe("completed\nIt ran.");
	});

	it("writes the command to shell.always for --always and finishes the run", async () => {
		const { repo, app } = await setup({ script: runs(NODE) });
		const runId = await paused(app);
		const t = recordingIo();
		expect(await runCommand(app, t.io, { allow: runId, scope: "always" })).toBe(
			0,
		);
		const file = join(repo.workspaceDir, ".mete", "policy.yaml");
		// The writer's own tests parse the file; the folder had none, so this is all of it.
		expect(await readFile(file, "utf8")).toBe(
			`shell:\n  always:\n    - ${NODE}\n`,
		);
	});

	it("offers no Always for a command the event masked and refuses --always for it", async () => {
		const { repo, app } = await setup({ script: runs(`echo ${TOKEN}`) });
		const t = recordingIo("", ["a"]);
		expect(await runCommand(app, t.io, { goal: "check node" })).toBe(2);
		expect(t.prompts).toEqual([
			"Allow once (o), for this run (r) or keep it paused (Enter)? ",
		]);
		expect(t.out.join("\n")).not.toContain(TOKEN);
		expect(t.err.join("\n")).not.toContain("--always");
		const runId = t.out[0]?.split(" ")[1] ?? "";
		const again = recordingIo();
		expect(
			await runCommand(app, again.io, { allow: runId, scope: "always" }),
		).toBe(1);
		expect(again.err[0]).toMatch(/^Always allow takes a command whose text/);
		await expect(
			readFile(join(repo.workspaceDir, ".mete", "policy.yaml")),
		).rejects.toThrow();
	});

	it("answers not_found for a run that is not paused for approval", async () => {
		const { app } = await setup({ noModels: true });
		const runId = await paused(app);
		const t = recordingIo();
		expect(await runCommand(app, t.io, { allow: runId, scope: "once" })).toBe(
			1,
		);
		expect(t.err).toEqual([`run ${runId} is not paused for approval`]);
	});
});

describe("mete daemon: mete/run.allow", { timeout: 30_000 }, () => {
	it("grants the ask and resumes the run; an unknown run is not_found", async () => {
		const { repo, app } = await setup({ script: runs(NODE) });
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		void daemonCommand(app, recordingIo().io, repo.workspaceDir, {
			input: toDaemon,
			output: toClient,
		});
		const c = createMessageConnection(
			new StreamMessageReader(toClient),
			new StreamMessageWriter(toDaemon),
		);
		// A connection keeps one handler per method, so one handler waits for both events.
		const waits = new Map<string, () => void>();
		const seen = (type: string) =>
			new Promise<void>((resolve) => void waits.set(type, resolve));
		const asked = seen("policy.asked");
		const completed = seen("run.completed");
		c.onNotification(DAEMON_METHODS.event, (e: { type: string }) =>
			waits.get(e.type)?.(),
		);
		c.listen();
		const { runId } = DaemonRunStartResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.runStart, {
				goal: "check node",
				templateId: null,
			}),
		);
		await asked;
		const unknown = "00000000-0000-4000-8000-000000000000";
		const refused = await c
			.sendRequest(DAEMON_METHODS.runAllow, { runId: unknown, scope: "once" })
			.catch((e: unknown) => e);
		expect(refused).toBeInstanceOf(ResponseError);
		const e = refused as ResponseError<unknown>;
		expect(e.code).toBe(DAEMON_ERROR_CODE);
		expect(DaemonErrorDataSchema.parse(e.data).code).toBe("not_found");
		expect(
			await c.sendRequest(DAEMON_METHODS.runAllow, { runId, scope: "once" }),
		).toBeNull();
		await completed;
		c.dispose();
		toDaemon.end();
	});
});
