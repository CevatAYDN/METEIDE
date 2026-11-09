import { randomUUID } from "node:crypto";
import {
	err,
	type LlmChunk,
	ok,
	type SkillRuntimeAdapter,
	type SkillRuntimeError,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineHarness, reply, T0 } from "../helpers/engine.js";
import { scriptedSkills } from "../helpers/skills.js";

type H = ReturnType<typeof engineHarness>;
const open: H[] = [];
afterEach(async () => {
	for (const h of open.splice(0)) {
		await h.stop();
		h.db.close();
	}
});

/** A scripted check whose verdict the test flips, standing in for security's revocation. */
const harness = (scripts: LlmChunk[][] = [reply("done")]) => {
	const h = engineHarness({ scripts });
	open.push(h);
	const verdict: { error?: SkillRuntimeError | undefined } = {};
	const check = vi.fn<SkillRuntimeAdapter["check"]>(async () =>
		verdict.error ? err(verdict.error) : ok(undefined),
	);
	const unused = async () => err({ code: "unavailable" as const });
	h.registry.provide<SkillRuntimeAdapter>("skill.runtime@1", {
		id: "security",
		trust: "core",
		features: [],
		impl: { check, load: unused, inventory: unused, catalog: unused },
	});
	return { h, check, verdict };
};
const status = (h: H, runId: string) => {
	const r = h.engine.status(runId);
	return r.ok ? r.value[0]?.status : undefined;
};

/** An S2 run paused by the user before its first reply could finish. */
const pausedS2 = async (t: ReturnType<typeof harness>) => {
	const started = await t.h.threadSkills.start({
		requestId: randomUUID(),
		goal: "hello",
	});
	if (!started.ok) throw new Error(started.error.message);
	const { runId } = started.value;
	await t.h.engine.pause(runId);
	await vi.waitFor(() => expect(status(t.h, runId)).toBe("paused"));
	return runId;
};

describe("S2 continuation guard", () => {
	it("refuses a manual resume of a revoked context and records the block", async () => {
		const t = harness();
		const runId = await pausedS2(t);
		const sent = t.h.requests.length;
		t.verdict.error = { code: "revoked", sourceId: "a".repeat(64) };
		expect(await t.h.engine.resume(runId)).toMatchObject({
			ok: false,
			error: { code: "failed" },
		});
		expect(status(t.h, runId)).toBe("paused");
		const context = t.h.store.load(runId)?.snapshot.context;
		expect(context?.skillBlock).toEqual({
			code: "revoked",
			sourceId: "a".repeat(64),
		});
		expect(context?.pause?.reason).toBe("user");
		expect(t.h.requests).toHaveLength(sent);
	});

	it("keeps refusing after same-byte reapproval at a new revision", async () => {
		const t = harness();
		const runId = await pausedS2(t);
		t.verdict.error = { code: "revoked", sourceId: "a".repeat(64) };
		await t.h.engine.resume(runId);
		const before = t.check.mock.calls.length;
		// Security refuses the old revision even if the same bytes were approved again.
		expect((await t.h.engine.resume(runId)).ok).toBe(false);
		expect(t.check.mock.calls.length).toBe(before + 1);
		expect(t.h.store.load(runId)?.snapshot.context.skillBlock?.code).toBe(
			"revoked",
		);
	});

	it("resumes and clears an earlier block once the check passes", async () => {
		const t = harness();
		const runId = await pausedS2(t);
		t.verdict.error = { code: "unavailable" };
		expect((await t.h.engine.resume(runId)).ok).toBe(false);
		t.verdict.error = undefined;
		expect((await t.h.engine.resume(runId)).ok).toBe(true);
		await vi.waitFor(() => expect(status(t.h, runId)).toBe("completed"));
		expect(t.h.store.load(runId)?.snapshot.context.skillBlock).toBeUndefined();
	});

	it("never auto-resumes a revoked run when its quota timer fires", async () => {
		const quota: LlmChunk[] = [
			{
				type: "error",
				error: {
					code: "quota_exhausted",
					message: "q",
					resumesAt: new Date(T0 + 60_000).toISOString(),
				},
			},
		];
		const t = harness([quota, reply("done")]);
		const started = await t.h.threadSkills.start({
			requestId: randomUUID(),
			goal: "hello",
		});
		if (!started.ok) throw new Error(started.error.message);
		const { runId } = started.value;
		await vi.waitFor(() => expect(t.h.timers).toHaveLength(1));
		t.verdict.error = { code: "revoked", sourceId: "a".repeat(64) };
		t.h.clock.now = T0 + 60_000;
		t.h.timers[0]?.fn();
		await vi.waitFor(() =>
			expect(t.h.store.load(runId)?.snapshot.context.skillBlock).toBeDefined(),
		);
		expect(status(t.h, runId)).toBe("paused");
		expect(t.h.store.load(runId)?.snapshot.context.pause?.reason).toBe("user");
		expect(t.h.store.load(runId)?.snapshot.context.pause?.resumesAt).toBe(
			undefined,
		);
		// `user` is not self-resuming, so the old timer callback returns without resuming.
		const before = t.check.mock.calls.length;
		t.h.timers[0]?.fn();
		expect(status(t.h, runId)).toBe("paused");
		expect(t.check.mock.calls.length).toBe(before);
		expect(t.h.requests).toHaveLength(1);
	});

	it("refuses an S2 run whose runtime port is missing, not as empty", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		open.push(h);
		const started = await h.threadSkills.start({
			requestId: randomUUID(),
			goal: "hello",
		});
		if (!started.ok) throw new Error(started.error.message);
		await h.engine.pause(started.value.runId);
		expect((await h.engine.resume(started.value.runId)).ok).toBe(false);
		expect(
			h.store.load(started.value.runId)?.snapshot.context.skillBlock,
		).toEqual({ code: "unavailable" });
	});

	it("dispatches no further model or tool call once the context is revoked mid-run", async () => {
		const call = reply("", [{ name: "fs_read", args: { path: "a" } }]);
		const h = engineHarness({ scripts: [call, call, reply("done")] });
		open.push(h);
		const skills = scriptedSkills(h.registry, h.skillLoadAdmission);
		const read = vi.fn(async () => {
			skills.revoke({ code: "revoked", sourceId: "a".repeat(64) });
			return ok({ content: "x" });
		});
		h.registry.provide("fs.read@1", {
			id: "fake",
			trust: "core",
			features: [],
			impl: { run: read },
		});
		const started = await h.threadSkills.start({
			requestId: randomUUID(),
			goal: "hello",
		});
		if (!started.ok) throw new Error(started.error.message);
		const { runId } = started.value;
		await vi.waitFor(() =>
			expect(h.store.load(runId)?.snapshot.context.skillBlock).toEqual({
				code: "revoked",
				sourceId: "a".repeat(64),
			}),
		);
		expect(status(h, runId)).toBe("paused");
		expect(read).toHaveBeenCalledOnce();
		expect(h.requests).toHaveLength(1);
		// History stays intact: the completed tool result is not claimed undone.
		expect(
			h.store
				.load(runId)
				?.snapshot.context.messages.some((m) => m.role === "tool"),
		).toBe(true);
	});

	it("leaves legacy runs without the S2 marker unchecked", async () => {
		const t = harness();
		const started = await t.h.thread.start({
			requestId: randomUUID(),
			goal: "hello",
		});
		if (!started.ok) throw new Error(started.error.message);
		await t.h.engine.pause(started.value.runId);
		expect((await t.h.engine.resume(started.value.runId)).ok).toBe(true);
		expect(t.check).not.toHaveBeenCalled();
	});
});
