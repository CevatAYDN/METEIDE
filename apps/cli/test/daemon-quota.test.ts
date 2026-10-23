import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	type ChatChunk,
	DAEMON_METHODS,
	DaemonQuotaResultSchema,
	DaemonRunStartResultSchema,
} from "@mete/contracts";
import { createNvidiaModule } from "@mete/providers";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
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

// mete/quota over the daemon protocol (ADR-050), through every real module: a fake provider with one
// request a day, a fake one with no model, and the real NVIDIA module without a key.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

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

describe("mete daemon quota", () => {
	it("says each provider's state, and that one is spent after a quota pause", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [
				scriptedProvider({ script: [READ, DONE] }, { limit: 1, daily: true }),
				scriptedProvider({ noModels: true }, { id: "shy" }),
				createNvidiaModule(),
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
		let paused: () => void = () => {};
		const quotaPause = new Promise<void>((r) => {
			paused = r;
		});
		c.onNotification(
			DAEMON_METHODS.event,
			(e: { type: string; payload: { reason?: string } }) => {
				if (e.type === "run.paused" && e.payload.reason === "quota") paused();
			},
		);
		c.listen();
		const ask = async () =>
			DaemonQuotaResultSchema.parse(await c.sendRequest(DAEMON_METHODS.quota));
		const quota = async () => (await ask()).providers;
		// The pool's day unit of the fake provider (ADR-054), defined by the states' model listing.
		const fakeDay = async () =>
			(await ask()).units.find((u) => u.providerId === "fake");

		expect(await quota()).toEqual([
			{ id: "fake", state: "ready" },
			{ id: "shy", state: "unusable" },
			{ id: "nvidia", state: "no_key" },
		]);
		expect(await fakeDay()).toMatchObject({
			unit: "requests_per_day",
			scope: null,
			used: 0,
			limit: 1,
		});
		DaemonRunStartResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.runStart, {
				goal: "g",
				templateId: null,
			}),
		);
		await quotaPause;
		const after = await quota();
		expect(after[0]).toMatchObject({ id: "fake", state: "exhausted" });
		expect(after.slice(1)).toEqual([
			{ id: "shy", state: "unusable" },
			{ id: "nvidia", state: "no_key" },
		]);
		const spent = await fakeDay();
		expect(spent).toMatchObject({ used: 1, limit: 1 });
		// The one request of the run, with its time (ADR-055).
		expect(spent?.history.map((h) => h.amount)).toEqual([1]);

		toDaemon.end();
		expect(await serving).toBe(0);
		c.dispose();
	});
});
