import { randomUUID } from "node:crypto";
import { err } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineHarness, slow } from "../helpers/engine.js";
import { scriptedSkills } from "../helpers/skills.js";

type H = ReturnType<typeof engineHarness>;
const open: H[] = [];
afterEach(async () => {
	for (const h of open.splice(0)) {
		await h.stop();
		h.db.close();
	}
});
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};
const BODY = "---\nname: review\ndescription: d\n---\nsecret-instruction-body";

const provideRuntime = (h: H) =>
	scriptedSkills(h.registry, h.skillLoadAdmission, BODY).load;

const runningS2 = async () => {
	const h = engineHarness({ scripts: [slow] });
	open.push(h);
	const load = provideRuntime(h);
	const started = await h.threadSkills.start({
		requestId: randomUUID(),
		goal: "hello",
	});
	if (!started.ok) throw new Error(started.error.message);
	const { runId } = started.value;
	await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(0));
	const owner =
		h.store.load(runId)?.snapshot.context.skills?.contexts[0]?.owner;
	if (!owner) throw new Error("no S2 context");
	const req = { owner, roleId: "assistant", version, origin: "model" as const };
	return { h, load, runId, req };
};

describe("engine skill loading", () => {
	it("keeps the loaded snapshot in run state, out of ordinary messages", async () => {
		const { h, runId, req } = await runningS2();
		const loaded = await h.loadSkill(runId, req);
		if (!loaded.ok) throw new Error(loaded.error.code);
		await h.engine.pause(runId);
		const context = h.store.load(runId)?.snapshot.context;
		expect(
			context?.skills?.contexts[0]?.snapshots.map((x) => x.receiptId),
		).toEqual([loaded.value.receiptId]);
		expect(JSON.stringify(context?.messages)).not.toContain(
			"secret-instruction-body",
		);
	});

	it("refuses once the run is paused, without calling security", async () => {
		const { h, load, runId, req } = await runningS2();
		await h.engine.pause(runId);
		expect(await h.loadSkill(runId, req)).toEqual(err({ code: "stale" }));
		expect(load).not.toHaveBeenCalled();
	});

	it("refuses an unknown run", async () => {
		const { h, req } = await runningS2();
		expect(await h.loadSkill(randomUUID(), req)).toEqual(
			err({ code: "stale" }),
		);
	});
});
