import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonStatusResultSchema,
	type MeteEvent,
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
import { lockHolder, runLockFile } from "../src/infrastructure/run-lock.js";
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

	it("refuses without an engine, on the folder it was given, and frees the lock", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const t = recordingIo();
		const env = {
			cwd: join(repo.workspaceDir, ".."),
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			daemon: () => ({ input: new PassThrough(), output: new PassThrough() }),
		};
		expect(await main(["daemon", "repo"], t.io, env)).toBe(1);
		expect(t.out).toEqual([]);
		expect(t.err).toContain("core-engine is not active.");
		expect(await lockHolder(runLockFile(repo.workspaceDir))).toBeUndefined();
	});
});
