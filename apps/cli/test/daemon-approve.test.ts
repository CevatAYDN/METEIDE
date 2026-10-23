import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	type ChatChunk,
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonErrorDataSchema,
	DaemonEventsResultSchema,
	DaemonRunStartResultSchema,
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

// A team run started, stopped at its human checkpoint and approved over the daemon protocol, as the
// desktop's approvals inbox does it (ADR-048); only the provider behind the gateway is scripted.

// Two tasks of one coder role; the human checks the second before the run completes.
const DUO = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: writer, name: Writer, goal: Write, tier: coder, capabilities: [] }
tasks:
  - { id: notes, role: writer, title: Take notes }
  - { id: summary, role: writer, title: Summarize, context: [notes], expected_output: "artifact:research-report@1" }
policies: { human_checkpoints: [summary] }
`;

const say = (text: string): ChatChunk[] => [
	{ type: "text", text },
	{ type: "finish", reason: "stop", usage: { prompt: 10, completion: 5 } },
];

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

describe("mete daemon approvals", () => {
	it("starts a team run, stops it for the human and finishes it on mete/run.approve", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		await mkdir(join(repo.workspaceDir, ".mete", "teams"), { recursive: true });
		await writeFile(join(repo.workspaceDir, ".mete", "teams", "duo.yaml"), DUO);
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [
				scriptedProvider({ script: [say("three notes"), say("one summary")] }),
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
		const types: string[] = [];
		const got: { id: string; runId?: string }[] = [];
		let waiting: () => void = () => {};
		let completed: () => void = () => {};
		const asked = new Promise<void>((r) => {
			waiting = r;
		});
		const done = new Promise<void>((r) => {
			completed = r;
		});
		c.onNotification(
			DAEMON_METHODS.event,
			(e: { id: string; type: string; runId?: string }) => {
				got.push(e);
				types.push(e.type);
				if (e.type === "approval.requested") waiting();
				if (e.type === "run.completed") completed();
			},
		);
		c.listen();

		const { runId } = DaemonRunStartResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.runStart, {
				goal: "free models",
				templateId: "duo",
			}),
		);
		await asked;
		const unclear = await failure(
			c.sendRequest(DAEMON_METHODS.runApprove, {
				runId,
				input: { decision: "revise" },
			}),
		);
		// A revision without feedback is refused at the boundary, before the engine.
		expect(unclear.code).toBe(ErrorCodes.InvalidParams);
		expect(
			await c.sendRequest(DAEMON_METHODS.runApprove, {
				runId,
				input: { decision: "approve" },
			}),
		).toBeNull();
		await done;
		expect(types).toEqual(
			expect.arrayContaining(["approval.requested", "approval.resolved"]),
		);

		// The history is what the client saw live, in the same order (ADR-051); the forwarder also
		// sends events of no run, so only this run's count.
		const history = DaemonEventsResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.events, { runId }),
		);
		expect(history.unreadable).toBe(0);
		const live = got.filter((e) => e.runId === runId).map((e) => e.id);
		expect(history.events.map((e) => e.id)).toEqual(
			live.slice(0, history.events.length),
		);
		expect(history.events.map((e) => e.type)).toContain("run.completed");
		// The Board places a card by its task.created taskId and its status changes (ADR-051).
		const created = history.events.filter((e) => e.type === "task.created");
		expect(created).toHaveLength(2);
		expect(created.every((e) => e.taskId)).toBe(true);
		const reached = history.events.flatMap((e) =>
			e.type === "task.status.changed" ? [e.payload.to] : [],
		);
		expect(reached).toEqual(
			expect.arrayContaining(["in_progress", "approved"]),
		);
		// The fold's rule (ui-studio agents.ts): each agent is created inside its first model turn,
		// whose thinking.started carries no agent id yet.
		for (const e of history.events.filter((x) => x.type === "agent.created")) {
			const turn = history.events.filter((x) => x.taskId === e.taskId);
			const at = turn.indexOf(e);
			const start = turn.findIndex((x) => x.type === "agent.thinking.started");
			const end = turn.findIndex((x) => x.type === "agent.thinking.ended");
			expect(turn[start]?.agentId).toBeUndefined();
			expect(start < at && at < end).toBe(true);
		}
		const unknown = await failure(
			c.sendRequest(DAEMON_METHODS.events, { runId: crypto.randomUUID() }),
		);
		expect(DaemonErrorDataSchema.parse(unknown.data).code).toBe("not_found");

		const late = await failure(
			c.sendRequest(DAEMON_METHODS.runResume, { runId }),
		);
		expect(late.code).toBe(DAEMON_ERROR_CODE);
		expect(DaemonErrorDataSchema.parse(late.data).code).toBe("invalid_state");

		toDaemon.end();
		expect(await serving).toBe(0);
		expect(t.out).toEqual([]);
		c.dispose();
	});
});
