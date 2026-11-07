import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatRequest, ConversationThreadV2Adapter } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import { type App, createApp, engineOf } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

const portOf = (app: App) => {
	const result = app.registry.resolve<ConversationThreadV2Adapter>(
		"conversation.thread@2",
	);
	if (!result.ok) throw new Error("context capability missing");
	return result.value[0].impl;
};
const ended = (app: App, runId: string) =>
	vi.waitFor(() => {
		const engine = engineOf(app);
		expect(engine.ok && engine.value.status(runId)).toMatchObject({
			ok: true,
			value: [{ status: "completed" }],
		});
	});

it("keeps explicitly supplied buffer context through real composition, retries and restart", async () => {
	const repo = await tempRepo({ "sample.ts": "const disk = 'disk-only';\n" });
	const seen: ChatRequest[] = [];
	const secrets = memorySecrets();
	const boot = async () => {
		const result = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			secrets,
			logger: silent,
			providers: [
				scriptedProvider({
					seen,
					script: [
						[
							{ type: "text", text: "Reviewed." },
							{
								type: "finish",
								reason: "stop",
								usage: { prompt: 1, completion: 1 },
							},
						],
					],
				}),
			],
		});
		if (!result.ok) throw new Error("fixture app failed");
		return result.value;
	};
	let app = await boot();
	try {
		let port = portOf(app);
		const prepared = await port.prepare({
			path: join(repo.workspaceDir, "sample.ts"),
			content: "const selected = 'unsaved-attachment-needle';",
			modified: true,
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 44 },
			},
		});
		expect(prepared.ok).toBe(true);
		if (!prepared.ok) throw new Error("preview failed");
		expect(seen).toHaveLength(0);
		expect(prepared.value.path).toBe("sample.ts");
		await writeFile(
			join(repo.workspaceDir, "sample.ts"),
			"const disk = 'changed-after-preview';\n",
		);
		const input = {
			requestId: crypto.randomUUID(),
			goal: "Review selected text",
			attachments: [prepared.value],
		};
		const first = await port.start(input);
		if (!first.ok) throw new Error("attached start failed");
		await ended(app, first.value.runId);
		expect(JSON.stringify(seen)).toContain("unsaved-attachment-needle");
		expect(JSON.stringify(seen)).not.toContain("changed-after-preview");
		expect(await port.context({ runId: first.value.runId })).toEqual({
			ok: true,
			value: { runId: first.value.runId, attachments: [prepared.value] },
		});
		expect(await port.list({ query: "unsaved-attachment-needle" })).toEqual({
			ok: true,
			value: { conversations: [] },
		});
		const calls = seen.length;
		await writeFile(join(repo.workspaceDir, ".meteignore"), "sample.ts\n");
		expect(await port.start(input)).toEqual(first);
		expect(seen).toHaveLength(calls);
		expect(
			(await port.start({ ...input, requestId: crypto.randomUUID() })).ok,
		).toBe(false);
		expect(seen).toHaveLength(calls);
		await app.stop();
		app = await boot();
		port = portOf(app);
		expect(await port.start(input)).toEqual(first);
		expect(seen).toHaveLength(calls);
		const restored = await port.context({ runId: first.value.runId });
		expect(restored).toMatchObject({
			ok: true,
			value: { attachments: [prepared.value] },
		});
		await writeFile(join(repo.workspaceDir, ".meteignore"), "");
		const next = await port.reply({
			conversationId: first.value.conversationId,
			expectedRunId: first.value.runId,
			requestId: crypto.randomUUID(),
			message: "Second authored turn",
			attachments: [prepared.value],
		});
		if (!next.ok) throw new Error("attached reply failed");
		await ended(app, next.value.runId);
		expect(next.value.conversationId).toBe(first.value.conversationId);
		const rows = await port.list({});
		expect(rows).toMatchObject({
			ok: true,
			value: { conversations: [{ turnCount: 2, title: input.goal }] },
		});
		const engine = engineOf(app);
		if (!engine.ok || !engine.value.remove)
			throw new Error("remove unavailable");
		expect((await engine.value.remove(next.value.runId)).ok).toBe(true);
		expect((await port.context({ runId: next.value.runId })).ok).toBe(false);
	} finally {
		await app.stop();
		await repo.close();
	}
}, 30_000);
