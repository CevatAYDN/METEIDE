import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	type ChatChunk,
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonErrorDataSchema,
	DaemonRunStartResultSchema,
	type ModelRef,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	ErrorCodes,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// mete/run.model over the daemon protocol (ADR-122): sets or clears per-run model preference.

const DUO = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: writer, name: Writer, goal: Write, tier: coder, capabilities: [] }
tasks:
  - { id: notes, role: writer, title: Take notes }
  - { id: summary, role: writer, title: Summarize, context: [notes] }
policies: { human_checkpoints: [summary] }
`;

const say = (text: string): ChatChunk[] => [
	{ type: "text", text },
	{ type: "finish", reason: "stop", usage: { prompt: 10, completion: 5 } },
];

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 1, completion: 1 },
});
const READ: ChatChunk[] = [
	{ type: "tool-call", id: "c1", name: "fs_read", args: { path: "a.txt" } },
	finish("tool-calls"),
];
const DONE: ChatChunk[] = [{ type: "text", text: "done" }, finish("stop")];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const failure = async (p: Promise<unknown>) => {
	try {
		await p;
	} catch (e) {
		if (e instanceof ResponseError) return e;
		throw e;
	}
	throw new Error("the request should have failed");
};

const MODEL_A: ModelRef = {
	providerId: "groq",
	modelId: "llama-3.3-70b",
};

describe("mete daemon run.model (ADR-122)", () => {
	it("sets and clears role model preference and handles errors on team run", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		await mkdir(join(repo.workspaceDir, ".mete", "teams"), {
			recursive: true,
		});
		await writeFile(join(repo.workspaceDir, ".mete", "teams", "duo.yaml"), DUO);
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [
				scriptedProvider({
					script: [say("notes done"), say("summary done")],
				}),
			],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		const t = recordingIo();
		const serving = daemonCommand(app.value, t.io, repo.workspaceDir, {
			input: toDaemon,
			output: toClient,
		});
		const c = createMessageConnection(
			new StreamMessageReader(toClient),
			new StreamMessageWriter(toDaemon),
		);
		let waiting: () => void = () => {};
		let completed: () => void = () => {};
		const paused = new Promise<void>((r) => {
			waiting = r;
		});
		const done = new Promise<void>((r) => {
			completed = r;
		});
		c.onNotification(
			DAEMON_METHODS.event,
			(e: { id: string; type: string }) => {
				if (e.type === "approval.requested") waiting();
				if (e.type === "run.completed") completed();
			},
		);
		c.listen();

		const { runId } = DaemonRunStartResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.runStart, {
				goal: "steer model",
				templateId: "duo",
			}),
		);
		await paused;

		// 1. Role model preference on paused team run answers null
		expect(
			await c.sendRequest(DAEMON_METHODS.runModel, {
				runId,
				roleId: "writer",
				model: MODEL_A,
			}),
		).toBeNull();

		// 2. Clearing role model preference with null answers null
		expect(
			await c.sendRequest(DAEMON_METHODS.runModel, {
				runId,
				roleId: "writer",
				model: null,
			}),
		).toBeNull();

		// 3. Error handling: invalid roleId on team template refuses with bad_input
		const badRole = await failure(
			c.sendRequest(DAEMON_METHODS.runModel, {
				runId,
				roleId: "nonexistent",
				model: MODEL_A,
			}),
		);
		expect(badRole.code).toBe(DAEMON_ERROR_CODE);
		expect(DaemonErrorDataSchema.parse(badRole.data).code).toBe("bad_input");

		// 4. Error handling: missing model field is rejected at boundary
		const missingModel = await failure(
			c.sendRequest(DAEMON_METHODS.runModel, {
				runId,
				roleId: "writer",
			}),
		);
		expect(missingModel.code).toBe(ErrorCodes.InvalidParams);

		// 5. Error handling: unknown runId refuses with not_found
		const unknown = await failure(
			c.sendRequest(DAEMON_METHODS.runModel, {
				runId: crypto.randomUUID(),
				model: null,
			}),
		);
		expect(unknown.code).toBe(DAEMON_ERROR_CODE);
		expect(DaemonErrorDataSchema.parse(unknown.data).code).toBe("not_found");

		// Approve the run and finish it
		await c.sendRequest(DAEMON_METHODS.runApprove, {
			runId,
			input: { decision: "approve" },
		});
		await done;

		// 6. Error handling: completed run refuses model changes with invalid_state
		const late = await failure(
			c.sendRequest(DAEMON_METHODS.runModel, {
				runId,
				roleId: "writer",
				model: MODEL_A,
			}),
		);
		expect(late.code).toBe(DAEMON_ERROR_CODE);
		expect(DaemonErrorDataSchema.parse(late.data).code).toBe("invalid_state");

		toDaemon.end();
		expect(await serving).toBe(0);
		c.dispose();
	});

	it("sets and clears single-agent model preference and rejects roleId", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [
				scriptedProvider({ script: [READ, DONE] }, { limit: 1, daily: true }),
			],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		const t = recordingIo();
		const serving = daemonCommand(app.value, t.io, repo.workspaceDir, {
			input: toDaemon,
			output: toClient,
		});
		const c = createMessageConnection(
			new StreamMessageReader(toClient),
			new StreamMessageWriter(toDaemon),
		);
		let waiting: () => void = () => {};
		const paused = new Promise<void>((r) => {
			waiting = r;
		});
		c.onNotification(
			DAEMON_METHODS.event,
			(e: { id: string; type: string }) => {
				if (e.type === "run.paused") waiting();
			},
		);
		c.listen();

		const { runId } = DaemonRunStartResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.runStart, {
				goal: "single agent steer",
				templateId: null,
			}),
		);
		await paused;

		// 1. Single agent model preference answers null
		expect(
			await c.sendRequest(DAEMON_METHODS.runModel, {
				runId,
				model: MODEL_A,
			}),
		).toBeNull();

		// 2. Reject roleId for single agent run with bad_input
		const invalidRole = await failure(
			c.sendRequest(DAEMON_METHODS.runModel, {
				runId,
				roleId: "coder",
				model: MODEL_A,
			}),
		);
		expect(invalidRole.code).toBe(DAEMON_ERROR_CODE);
		expect(DaemonErrorDataSchema.parse(invalidRole.data).code).toBe(
			"bad_input",
		);

		// 3. Clear single agent model preference with null answers null
		expect(
			await c.sendRequest(DAEMON_METHODS.runModel, {
				runId,
				model: null,
			}),
		).toBeNull();

		toDaemon.end();
		expect(await serving).toBe(0);
		c.dispose();
	});
});
