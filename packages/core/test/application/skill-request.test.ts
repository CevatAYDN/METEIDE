import { randomUUID } from "node:crypto";
import type { ChatMessage, LlmChatRequest, LlmChunk } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toSummarize } from "../../src/domain/compact.js";
import { engineHarness, reply } from "../helpers/engine.js";
import { scriptedSkills } from "../helpers/skills.js";

type H = ReturnType<typeof engineHarness>;
const open: H[] = [];
afterEach(async () => {
	for (const h of open.splice(0)) {
		await h.stop();
		h.db.close();
	}
});
const BODY = "---\nname: review\ndescription: d\n---\nALWAYS-RUN-THE-LINTER";
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};

/**
 * Explicit skills must reach the first model call. Hold it, pause and resume to
 * verify that the same retained block also survives continuation.
 */
const loadedRun = async (scripts: LlmChunk[][]) => {
	const gate = Promise.withResolvers<void>();
	const held = async function* (
		_r: LlmChatRequest,
		signal: AbortSignal,
	): AsyncGenerator<LlmChunk> {
		await Promise.race([
			gate.promise,
			new Promise((resolve) => signal.addEventListener("abort", resolve)),
		]);
		yield { type: "error", error: { code: "aborted", message: "x" } };
	};
	const h = engineHarness({ scripts: [held, ...scripts] });
	open.push(h);
	scriptedSkills(h.registry, h.skillLoadAdmission, BODY);
	const started = await h.threadSkills.start({
		requestId: randomUUID(),
		goal: "hello",
		skills: { mode: "manual", selected: [version] },
	});
	if (!started.ok) throw new Error(started.error.message);
	const { runId } = started.value;
	await vi.waitFor(() => expect(h.requests).toHaveLength(1));
	await h.engine.pause(runId);
	gate.resolve();
	return { h, runId };
};

const userText = (m: ChatMessage | undefined) =>
	m?.role === "user" && typeof m.content === "string" ? m.content : "";

describe("pinned skills in model requests", () => {
	it("sends the retained body after system, before history, and only in the request", async () => {
		const { h, runId } = await loadedRun([reply("done")]);
		expect(JSON.stringify(h.requests[0]?.messages)).toContain(
			"ALWAYS-RUN-THE-LINTER",
		);
		expect((await h.engine.resume(runId)).ok).toBe(true);
		await vi.waitFor(() => expect(h.requests).toHaveLength(2));
		const sent = h.requests[1]?.messages ?? [];
		expect(sent[0]?.role).toBe("system");
		expect(userText(sent[1])).toContain("<approved-skills>");
		expect(userText(sent[1])).toContain("ALWAYS-RUN-THE-LINTER");
		expect(userText(sent[2])).not.toContain("<approved-skills>");
		const stored = h.store.load(runId)?.snapshot.context.messages ?? [];
		expect(JSON.stringify(stored)).not.toContain("ALWAYS-RUN-THE-LINTER");
	});

	it("never drops the block to fit: too_large folds history only, then pauses", async () => {
		const tooLarge: LlmChunk[] = [
			{ type: "error", error: { code: "too_large", message: "x" } },
		];
		const { h, runId } = await loadedRun([tooLarge, tooLarge, tooLarge]);
		expect((await h.engine.resume(runId)).ok).toBe(true);
		await vi.waitFor(() =>
			expect(h.engine.status(runId)).toMatchObject({
				value: [{ status: "paused" }],
			}),
		);
		for (const req of h.requests.slice(1))
			if (!("tier" in req.target && req.target.tier === "fast"))
				expect(userText(req.messages[1])).toContain("ALWAYS-RUN-THE-LINTER");
	});

	it("rebuilds the same block on every request of the run", async () => {
		const call = reply("", [{ name: "fs_read", args: { path: "a" } }]);
		const { h, runId } = await loadedRun([call, reply("done")]);
		h.registry.provide("fs.read@1", {
			id: "fake",
			trust: "core",
			features: [],
			impl: { run: async () => ({ ok: true, value: { content: "x" } }) },
		});
		expect((await h.engine.resume(runId)).ok).toBe(true);
		await vi.waitFor(() => expect(h.requests).toHaveLength(3));
		expect(userText(h.requests[1]?.messages[1])).toBe(
			userText(h.requests[2]?.messages[1]),
		);
	});
});

describe("compaction counts the pinned block", () => {
	const history: ChatMessage[] = [
		{ role: "system", content: "s" },
		{ role: "user", content: "goal" },
		...Array.from({ length: 6 }, (_, i): ChatMessage[] => [
			{ role: "assistant", content: `turn ${i}` },
			{ role: "user", content: "ok" },
		]).flat(),
	];

	it("folds once the pinned block pushes the request past the threshold", () => {
		const window = 1_000;
		expect(toSummarize(history, window)).toBeUndefined();
		const pinned: ChatMessage[] = [
			{ role: "user", content: "p".repeat(3_000) },
		];
		const split = toSummarize(history, window, pinned);
		expect(split).toBeDefined();
		expect(JSON.stringify(split)).not.toContain("ppp");
	});
});
