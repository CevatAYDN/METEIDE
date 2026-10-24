import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	type ChatChunk,
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonCheckpointRestoreResultSchema,
	DaemonErrorDataSchema,
	DaemonEventsResultSchema,
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
import { rollbackCommand } from "../src/application/rollback.js";
import { createApp, engineOf } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// Restoring a git checkpoint (ADR-079) through every real module: a run fixes a typo with a
// checkpoint before the edit, and `mete rollback` or `mete/checkpoint.restore` brings the typo back.

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const EDIT: ChatChunk[][] = [
	[
		{
			type: "tool-call",
			id: "c1",
			name: "fs_edit",
			args: { path: "greet.js", oldStr: "Helo", newStr: "Hello" },
		},
		finish("tool-calls"),
	],
	[{ type: "text", text: "Fixed." }, finish("stop")],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

// A completed run that edited greet.js after its checkpoint 1.
const editedRun = async () => {
	const repo = await tempRepo({
		"greet.js": 'export const greet = (n) => "Helo " + n;\n',
	});
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		templatesDir: join(repo.globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script: EDIT })],
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	close = async () => {
		await app.value.stop();
		await repo.close();
	};
	expect(
		await runCommand(app.value, recordingIo().io, { goal: "fix the typo" }),
	).toBe(0);
	const engine = engineOf(app.value);
	const runs = engine.ok ? engine.value.status() : undefined;
	const runId = runs?.ok ? runs.value[0]?.id : undefined;
	if (!runId) throw new Error("no run");
	const greet = () => readFile(join(repo.workspaceDir, "greet.js"), "utf8");
	expect(await greet()).toContain("Hello");
	return { app: app.value, repo, runId, greet };
};

describe("mete rollback without git (ADR-080)", () => {
	it("restores a file snapshot, deleting nothing the run did not create, and undoes it", async () => {
		const root = await mkdtemp(join(tmpdir(), "mete-nogit-"));
		const workspaceDir = join(root, "work");
		await mkdir(workspaceDir);
		await writeFile(
			join(workspaceDir, "greet.js"),
			'export const greet = (n) => "Helo " + n;\n',
		);
		const app = await createApp({
			workspaceDir,
			globalDir: join(root, "global"),
			templatesDir: join(root, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ script: EDIT })],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await rm(root, { recursive: true, force: true });
		};
		expect(
			await runCommand(app.value, recordingIo().io, { goal: "fix the typo" }),
		).toBe(0);
		const engine = engineOf(app.value);
		const runs = engine.ok ? engine.value.status() : undefined;
		const runId = runs?.ok ? runs.value[0]?.id : undefined;
		if (!runId) throw new Error("no run");
		const greet = () => readFile(join(workspaceDir, "greet.js"), "utf8");
		expect(await greet()).toContain('"Hello "');
		const t = recordingIo();
		expect(await rollbackCommand(app.value, t.io, runId, "1")).toBe(0);
		expect(t.out).toEqual([
			`restored snapshots/${runId}/1`,
			`undo with: mete rollback ${runId} 2`,
		]);
		expect(await greet()).toContain('"Helo "');
		expect(await rollbackCommand(app.value, recordingIo().io, runId, "2")).toBe(
			0,
		);
		expect(await greet()).toContain('"Hello "');
	});
});

describe("mete rollback", () => {
	it("restores a checkpoint, and the line it prints undoes the restore", async () => {
		const { app, runId, greet } = await editedRun();
		const t = recordingIo();
		expect(await rollbackCommand(app, t.io, runId, "1")).toBe(0);
		expect(await greet()).toContain('"Helo "');
		expect(t.out).toEqual([
			`restored refs/mete/checkpoints/${runId}/1`,
			`undo with: mete rollback ${runId} 2`,
		]);
		expect(await rollbackCommand(app, recordingIo().io, runId, "2")).toBe(0);
		expect(await greet()).toContain('"Hello "');
	});

	it("refuses a number that is not one, and a checkpoint the run does not have", async () => {
		const { app, runId, greet } = await editedRun();
		const t = recordingIo();
		expect(await rollbackCommand(app, t.io, runId, "one")).toBe(1);
		expect(await rollbackCommand(app, t.io, runId, "9")).toBe(1);
		expect(t.err).toEqual([
			"one is not a checkpoint number (1, 2, 3, ...)",
			`not_found: no such checkpoint in ${runId}`,
		]);
		expect(await greet()).toContain('"Hello "');
	});
});

describe("mete/checkpoint.restore", () => {
	it("restores the checkpoint whose checkpoint.created event has the id, and refuses an unknown id", async () => {
		const { app, repo, runId, greet } = await editedRun();
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		const serving = daemonCommand(app, recordingIo().io, repo.workspaceDir, {
			input: toDaemon,
			output: toClient,
		});
		const c = createMessageConnection(
			new StreamMessageReader(toClient),
			new StreamMessageWriter(toDaemon),
		);
		c.listen();
		const history = DaemonEventsResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.events, { runId }),
		);
		const checkpoint = history.events.find(
			(e) => e.type === "checkpoint.created",
		);
		if (!checkpoint) throw new Error("no checkpoint.created");
		const answer = DaemonCheckpointRestoreResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.checkpointRestore, {
				runId,
				checkpointId: checkpoint.id,
			}),
		);
		expect(answer).toEqual({
			ref: `refs/mete/checkpoints/${runId}/1`,
			undo: `refs/mete/checkpoints/${runId}/2`,
		});
		expect(await greet()).toContain('"Helo "');
		const refused = await c
			.sendRequest(DAEMON_METHODS.checkpointRestore, {
				runId,
				checkpointId: crypto.randomUUID(),
			})
			.then(
				() => undefined,
				(e: unknown) => e,
			);
		if (!(refused instanceof ResponseError)) throw new Error("not refused");
		expect(refused.code).toBe(DAEMON_ERROR_CODE);
		expect(DaemonErrorDataSchema.parse(refused.data).code).toBe("not_found");
		toDaemon.end();
		expect(await serving).toBe(0);
		c.dispose();
	});
});
