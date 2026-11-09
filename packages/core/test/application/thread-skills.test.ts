import { randomUUID } from "node:crypto";
import {
	err,
	ok,
	type SkillSelectionAdapter,
	type SkillVersion,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";
import { scriptedSkills } from "../helpers/skills.js";

type Harness = ReturnType<typeof engineHarness>;
const open: Harness[] = [];
afterEach(async () => {
	for (const h of open.splice(0)) {
		await h.stop();
		h.db.close();
	}
});
const harness = (selection?: SkillSelectionAdapter["check"]) => {
	const h = engineHarness({ scripts: [reply("done")] });
	open.push(h);
	// S2 runs are checked before every dispatch, so they need a runtime port to finish.
	scriptedSkills(h.registry, h.skillLoadAdmission, undefined, {
		selection: false,
	});
	const check = vi.fn<SkillSelectionAdapter["check"]>(
		selection ?? (async () => ok(null)),
	);
	h.registry.provide<SkillSelectionAdapter>("skill.selection@1", {
		id: "security",
		trust: "core",
		features: [],
		impl: { check },
	});
	return { h, check };
};
const version = (n: number): SkillVersion => ({
	sourceId: n.toString(16).padStart(64, "0"),
	sha256: "b".repeat(64),
	revision: 1,
});
const completed = async (h: Harness, id: string) =>
	vi.waitFor(() =>
		expect(h.engine.status(id)).toMatchObject({
			value: [{ status: "completed" }],
		}),
	);

describe("conversation.thread@3 skill admission", () => {
	it("commits an S2 run with its policy and an empty assistant context", async () => {
		const { h, check } = harness();
		const started = await h.threadSkills.start({
			requestId: randomUUID(),
			goal: "hello",
			skills: { mode: "manual", selected: [version(1)] },
		});
		if (!started.ok) throw new Error(started.error.message);
		const context = h.store.load(started.value.runId)?.snapshot.context;
		expect(context?.skillRuntimeVersion).toBe(1);
		expect(context?.skills?.policy).toEqual({
			mode: "manual",
			roles: [{ roleId: "assistant", selected: [version(1)] }],
		});
		expect(context?.skills?.contexts).toEqual([
			expect.objectContaining({ roleId: "assistant", snapshots: [] }),
		]);
		expect(check).toHaveBeenCalledWith(
			{ selected: [version(1)] },
			expect.any(AbortSignal),
		);
	});

	it("defaults a new start to auto without consulting skill modules", async () => {
		const { h, check } = harness();
		const started = await h.threadSkills.start({
			requestId: randomUUID(),
			goal: "hello",
		});
		if (!started.ok) throw new Error(started.error.message);
		expect(
			h.store.load(started.value.runId)?.snapshot.context.skills?.policy,
		).toEqual({ mode: "auto", roles: [{ roleId: "assistant", selected: [] }] });
		expect(check).not.toHaveBeenCalled();
	});

	it("creates no run when preflight refuses the selection", async () => {
		const { h } = harness(async () =>
			err({ code: "revoked", sourceId: version(1).sourceId }),
		);
		const refused = await h.threadSkills.start({
			requestId: randomUUID(),
			goal: "hello",
			skills: { mode: "manual", selected: [version(1)] },
		});
		expect(refused).toMatchObject({ ok: false, error: { code: "bad_input" } });
		expect(h.store.list()).toEqual([]);
		expect(h.requests).toEqual([]);
	});

	it("refuses a nonempty selection when no selection port exists", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		open.push(h);
		const refused = await h.threadSkills.start({
			requestId: randomUUID(),
			goal: "hello",
			skills: { mode: "manual", selected: [version(1)] },
		});
		expect(refused).toMatchObject({
			ok: false,
			error: { code: "not_supported" },
		});
		expect(h.store.list()).toEqual([]);
	});

	it("replays an exact intent without a second preflight or run", async () => {
		const { h, check } = harness();
		const input = {
			requestId: randomUUID(),
			goal: "hello",
			skills: { mode: "manual" as const, selected: [version(1)] },
		};
		const first = await h.threadSkills.start(input);
		expect(await h.threadSkills.start(input)).toEqual(first);
		expect(check).toHaveBeenCalledOnce();
		expect(h.store.list()).toHaveLength(1);
		expect(
			await h.threadSkills.start({
				...input,
				skills: { mode: "auto", selected: [] },
			}),
		).toMatchObject({ ok: false, error: { code: "bad_input" } });
	});

	it("inherits only the predecessor's mode on an omitted reply policy", async () => {
		const { h } = harness();
		const started = await h.threadSkills.start({
			requestId: randomUUID(),
			goal: "hello",
			skills: { mode: "manual", selected: [version(1)] },
		});
		if (!started.ok) throw new Error(started.error.message);
		await completed(h, started.value.runId);
		const next = await h.threadSkills.reply({
			requestId: randomUUID(),
			conversationId: started.value.conversationId,
			expectedRunId: started.value.runId,
			message: "next",
		});
		if (!next.ok) throw new Error(next.error.message);
		expect(
			h.store.load(next.value.runId)?.snapshot.context.skills?.policy,
		).toEqual({
			mode: "manual",
			roles: [{ roleId: "assistant", selected: [] }],
		});
	});

	it("keeps @1 starts free of any S2 marker", async () => {
		const { h } = harness();
		const started = await h.thread.start({
			requestId: randomUUID(),
			goal: "hello",
		});
		if (!started.ok) throw new Error(started.error.message);
		const context = h.store.load(started.value.runId)?.snapshot.context;
		expect(context?.skillRuntimeVersion).toBeUndefined();
		expect(context?.skills).toBeUndefined();
	});
});
