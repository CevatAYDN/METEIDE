import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonErrorDataSchema,
	DaemonQuotaResultSchema,
	DaemonRunStartResultSchema,
	DaemonStatusResultSchema,
	type MeteEvent,
	MeteEventSchema,
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
	lockHolder,
	runLockFile,
	takeRunLock,
} from "../src/infrastructure/run-lock.js";
import { main } from "../src/main.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// `mete daemon` through every real module; the desktop is a vscode-jsonrpc client on two PassThroughs.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const event = (type: string): MeteEvent =>
	({
		id: crypto.randomUUID(),
		type,
		ts: new Date().toISOString(),
		schema: 1,
		workspaceId: crypto.randomUUID(),
		source: "test",
		payload: {},
	}) as MeteEvent;

const clientOf = (toClient: PassThrough, toDaemon: PassThrough) => {
	const c = createMessageConnection(
		new StreamMessageReader(toClient),
		new StreamMessageWriter(toDaemon),
	);
	const got: unknown[] = [];
	c.onNotification(DAEMON_METHODS.event, (e) => void got.push(e));
	c.listen();
	return { c, got };
};

const failure = async (p: Promise<unknown>) => {
	try {
		await p;
	} catch (e) {
		if (e instanceof ResponseError) return e;
		throw e;
	}
	throw new Error("the request should have failed");
};

describe("mete daemon", () => {
	it("answers mete/status, forwards every event in order and stops when the client leaves", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ script: [] })],
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
		const { c, got } = clientOf(toClient, toDaemon);

		expect(
			DaemonStatusResultSchema.parse(
				await c.sendRequest(DAEMON_METHODS.status, {}),
			),
		).toEqual([]);
		const gone = await failure(
			c.sendRequest(DAEMON_METHODS.status, { runId: "nope" }),
		);
		expect(gone.code).toBe(DAEMON_ERROR_CODE);
		expect(gone.data).toEqual({ code: "not_found" });
		const bad = await failure(
			c.sendRequest(DAEMON_METHODS.status, { runId: "" }),
		);
		expect(bad.code).toBe(ErrorCodes.InvalidParams);

		const first = event("network.lost");
		const second = event("run.resumed");
		app.value.events.publish(first);
		app.value.events.publish(second);
		await c.sendRequest(DAEMON_METHODS.status, {});
		expect(got).toEqual([first, second]);

		toDaemon.end();
		expect(await serving).toBe(0);
		expect(t.out).toEqual([]);
		expect(t.err).toEqual([
			`serving METE to a desktop client for ${repo.workspaceDir}`,
		]);
		c.dispose();
	});

	it("starts a run with mete/run.start and forwards its events up to run.completed", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [
				scriptedProvider({
					script: [
						[
							{ type: "text", text: "done" },
							{
								type: "finish",
								reason: "stop",
								usage: { prompt: 3, completion: 1 },
							},
						],
					],
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
		const { c, got } = clientOf(toClient, toDaemon);
		const completed = new Promise<void>((resolve) =>
			c.onNotification(DAEMON_METHODS.event, (e: { type: string }) => {
				// One handler per method: this one replaces clientOf's, so it collects too.
				got.push(e);
				if (e.type === "run.completed") resolve();
			}),
		);

		const started = DaemonRunStartResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.runStart, {
				goal: "Reply with the single word done",
				templateId: null,
			}),
		);
		await completed;
		const events = got.map((e) => MeteEventSchema.parse(e));
		const types = events.map((e) => e.type);
		expect(types[0]).toBe("run.created");
		expect(types.at(-1)).toBe("run.completed");
		expect(types.indexOf("run.started")).toBeGreaterThan(0);
		expect(new Set(events.flatMap((e) => (e.runId ? [e.runId] : [])))).toEqual(
			new Set([started.runId]),
		);

		const bad = await failure(c.sendRequest(DAEMON_METHODS.runStart, {}));
		expect(bad.code).toBe(ErrorCodes.InvalidParams);
		const missing = await failure(
			c.sendRequest(DAEMON_METHODS.runStart, { goal: "g", templateId: "nope" }),
		);
		expect(missing.code).toBe(DAEMON_ERROR_CODE);
		expect(DaemonErrorDataSchema.parse(missing.data).code).toBe("not_found");

		toDaemon.end();
		expect(await serving).toBe(0);
		expect(t.out).toEqual([]);
		c.dispose();
	});

	it("serves without an engine and answers mete/status with not_ready and the reasons", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		const t = recordingIo();
		const done = main(["daemon", "repo"], t.io, {
			cwd: join(repo.workspaceDir, ".."),
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			daemon: () => ({ input: toDaemon, output: toClient }),
		});
		const { c } = clientOf(toClient, toDaemon);
		const refused = await failure(c.sendRequest(DAEMON_METHODS.status, {}));
		expect(refused.code).toBe(DAEMON_ERROR_CODE);
		const data = DaemonErrorDataSchema.parse(refused.data);
		const reasons = data.code === "not_ready" ? data.reasons : [];
		expect(reasons[0]).toBe("core-engine is not active.");
		expect(reasons.at(-1)).toBe(
			"Add a provider key with: mete key set openrouter",
		);
		// mete/quota needs no engine: on a first run it names each provider without a key (ADR-050).
		const quota = DaemonQuotaResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.quota),
		);
		expect(quota.providers.length).toBeGreaterThan(0);
		expect(quota.providers.map((p) => p.state)).toEqual(
			quota.providers.map(() => "no_key"),
		);

		toDaemon.end();
		expect(await done).toBe(0);
		expect(t.out).toEqual([]);
		expect(t.err).toEqual([
			`serving METE to a desktop client for ${repo.workspaceDir}`,
			...reasons,
		]);
		expect(await lockHolder(runLockFile(repo.workspaceDir))).toBeUndefined();
		c.dispose();
	});

	it("still refuses before it serves while another process holds the folder", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const lock = await takeRunLock(runLockFile(repo.workspaceDir));
		if (!lock.ok) throw new Error(lock.error);
		const t = recordingIo();
		const env = {
			cwd: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			daemon: () => ({ input: new PassThrough(), output: new PassThrough() }),
		};
		expect(await main(["daemon"], t.io, env)).toBe(1);
		expect(t.out).toEqual([]);
		expect(t.err[0]).toContain(`another mete command (pid ${process.pid}:`);
		await lock.value();
	});
});
