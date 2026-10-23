import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonErrorDataSchema,
	DaemonEstimateResultSchema,
	DaemonQuotaResultSchema,
	DaemonRunStartResultSchema,
	DaemonStatusResultSchema,
	DaemonStopAllResultSchema,
	DaemonTemplateReadResultSchema,
	DaemonTemplatesResultSchema,
	type MeteEvent,
	MeteEventSchema,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
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
	it("puts a role's estimate on its pinned model's provider (ADR-077)", async () => {
		const duo = [
			"apiVersion: mete/v1",
			"kind: TeamTemplate",
			"metadata: { id: duo, name: Duo, version: 1.0.0 }",
			"pattern: single",
			"roles:",
			"  - { id: writer, name: Writer, goal: Write, tier: coder, capabilities: [] }",
			"tasks:",
			"  - { id: write, role: writer, title: Write }",
			"",
		].join("\n");
		const estimateWith = async (pins: string | undefined) => {
			const repo = await tempRepo({ "a.txt": "a\n" });
			const meta = join(repo.workspaceDir, ".mete");
			await mkdir(join(meta, "teams"), { recursive: true });
			await writeFile(join(meta, "teams", "duo.yaml"), duo);
			if (pins) await writeFile(join(meta, "pins.yaml"), pins);
			const app = await createApp({
				workspaceDir: repo.workspaceDir,
				globalDir: repo.globalDir,
				templatesDir: join(repo.globalDir, "no-templates"),
				logger: silent,
				secrets: memorySecrets(),
				providers: [
					scriptedProvider({ script: [] }),
					scriptedProvider({ script: [] }, { id: "other" }),
				],
			});
			if (!app.ok) throw new Error(JSON.stringify(app.error));
			const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
			const serving = daemonCommand(
				app.value,
				recordingIo().io,
				repo.workspaceDir,
				{
					input: toDaemon,
					output: toClient,
				},
			);
			const { c } = clientOf(toClient, toDaemon);
			const answer = await c.sendRequest(DAEMON_METHODS.estimate, {
				templateId: "duo",
			});
			toDaemon.end();
			await serving;
			await app.value.stop();
			await repo.close();
			return answer;
		};
		expect(await estimateWith(undefined)).toEqual({
			providers: [{ providerId: "fake", requests: 12 }],
			unassigned: 0,
		});
		expect(await estimateWith("duo:\n  writer: other/coder-1\n")).toEqual({
			providers: [{ providerId: "other", requests: 12 }],
			unassigned: 0,
		});
	});

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

		// A single agent is one task on the coder tier, put on the first ready provider (ADR-068).
		expect(
			await c.sendRequest(DAEMON_METHODS.estimate, { templateId: null }),
		).toEqual({
			providers: [{ providerId: "fake", requests: 12 }],
			unassigned: 0,
		});
		const unknown = await failure(
			c.sendRequest(DAEMON_METHODS.estimate, { templateId: "nope" }),
		);
		expect(unknown.data).toEqual({ code: "not_found" });

		// mete/chain lists what a tier would try for the needs, for the editor's pinned model (ADR-077).
		expect(
			await c.sendRequest(DAEMON_METHODS.chain, {
				tier: "coder",
				needs: ["tool_calling"],
			}),
		).toEqual({ models: [{ providerId: "fake", modelId: "coder-1" }] });
		expect(
			await c.sendRequest(DAEMON_METHODS.chain, {
				tier: "coder",
				needs: ["vision"],
			}),
		).toEqual({ models: [] });
		const badChain = await failure(
			c.sendRequest(DAEMON_METHODS.chain, { tier: "huge", needs: [] }),
		);
		expect(badChain.code).toBe(ErrorCodes.InvalidParams);

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

	it("cancels every run that has not ended with mete/stop.all, a running one too (ADR-065)", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ hang: true })],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		const serving = daemonCommand(
			app.value,
			recordingIo().io,
			repo.workspaceDir,
			{
				input: toDaemon,
				output: toClient,
			},
		);
		const { c, got } = clientOf(toClient, toDaemon);
		const { runId } = DaemonRunStartResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.runStart, {
				goal: "wait",
				templateId: null,
			}),
		);
		await vi.waitFor(() =>
			expect(got).toContainEqual(
				expect.objectContaining({ type: "agent.created" }),
			),
		);

		const stopped = DaemonStopAllResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.stopAll),
		);
		expect(stopped).toEqual({ cancelled: [runId] });
		const [run] = DaemonStatusResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.status, { runId }),
		);
		expect(run?.status).toBe("cancelled");
		// An ended run is left alone, so a second press cancels nothing.
		expect(await c.sendRequest(DAEMON_METHODS.stopAll)).toEqual({
			cancelled: [],
		});

		toDaemon.end();
		expect(await serving).toBe(0);
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
		const unstopped = await failure(c.sendRequest(DAEMON_METHODS.stopAll));
		expect(unstopped.data).toEqual(refused.data);
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
		// The quota module is active without the engine; with no provider listed, no provider unit.
		expect(quota.units.every((u) => u.providerId === "*")).toBe(true);
		// mete/audit needs no engine either (ADR-053); a new folder has no rows.
		expect(await c.sendRequest(DAEMON_METHODS.audit, {})).toEqual({
			entries: [],
		});
		// mete/templates reads files only (ADR-058): the four built-in templates, by id.
		const listed = DaemonTemplatesResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.templates),
		);
		expect(listed.templates.map((x) => x.id)).toEqual([
			"game-studio",
			"research",
			"seo-audit",
			"web-dev",
		]);
		expect(listed.templates[0]).toEqual({
			id: "game-studio",
			name: "Game studio",
			description: "Idea to playable prototype",
		});
		// mete/estimate needs no engine either (ADR-068); with no provider ready, nothing is assigned.
		const estimate = DaemonEstimateResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.estimate, { templateId: "web-dev" }),
		);
		expect(estimate.providers).toEqual([]);
		expect(estimate.unassigned).toBeGreaterThan(0);
		// mete/template.read reads files only (ADR-075): a built-in template's text, and the codes of a miss.
		const read = DaemonTemplateReadResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.templateRead, { id: "web-dev" }),
		);
		expect(read.source).toBe("builtIn");
		expect(read.yaml).toContain("id: web-dev");
		for (const [id, code] of [
			["nope", "not_found"],
			["../x", "bad_input"],
		])
			expect(
				(await failure(c.sendRequest(DAEMON_METHODS.templateRead, { id })))
					.data,
			).toEqual({ code });

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
