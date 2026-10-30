import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	DAEMON_METHODS,
	DaemonKnowledgeSearchResultSchema,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import { createApp } from "../src/infrastructure/app.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

// mete/knowledge.search (ADR-159): the Memory screen's search over the workspace vault, through
// knowledge.search@1, with no engine and no model.

const LESSON = `---
type: lesson
title: Write collision tests early
---

# Why

The player fell through the floor until a collision test caught it.
`;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const served = async () => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	const lessons = join(repo.workspaceDir, ".mete", "knowledge", "lessons");
	await mkdir(lessons, { recursive: true });
	await writeFile(join(lessons, "write-collision-tests-early.md"), LESSON);
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		templatesDir: join(repo.globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
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
	const c = createMessageConnection(
		new StreamMessageReader(toClient),
		new StreamMessageWriter(toDaemon),
	);
	c.listen();
	close = async () => {
		toDaemon.end();
		await serving;
		c.dispose();
		await app.value.stop();
		await repo.close();
	};
	return c;
};

describe("mete/knowledge.search", { timeout: 30_000 }, () => {
	it("finds a vault note by a word of its body, and nothing for a word it lacks", async () => {
		const c = await served();
		const found = DaemonKnowledgeSearchResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.knowledgeSearch, { query: "floor" }),
		);
		expect(found.results[0]).toMatchObject({
			path: "lessons/write-collision-tests-early.md",
			scope: "workspace",
			type: "lesson",
			title: "Write collision tests early",
		});
		const none = await c.sendRequest(DAEMON_METHODS.knowledgeSearch, {
			query: "spaceship",
			type: "lesson",
		});
		expect(none).toEqual({ results: [] });
	});

	it("refuses an empty query as invalid params", async () => {
		const c = await served();
		await expect(
			c.sendRequest(DAEMON_METHODS.knowledgeSearch, { query: " " }),
		).rejects.toMatchObject({ code: -32602 });
	});
});
