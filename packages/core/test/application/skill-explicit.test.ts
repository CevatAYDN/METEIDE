import { randomUUID } from "node:crypto";
import { err, type SkillRuntimeAdapter } from "@mete/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";
import { scriptedSkills } from "../helpers/skills.js";

const open: ReturnType<typeof engineHarness>[] = [];
afterEach(async () => {
	for (const h of open.splice(0)) {
		await h.stop();
		h.db.close();
	}
});
const version = (n: number) => ({
	sourceId: String(n).repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
});
const setup = () => {
	const h = engineHarness({ scripts: [reply("done")] });
	open.push(h);
	return { h, runtime: scriptedSkills(h.registry, h.skillLoadAdmission) };
};

it("loads the entire explicit selection in order before the first provider call", async () => {
	const { h, runtime } = setup();
	const selected = [version(1), version(2)];
	const started = await h.threadSkills.start({
		requestId: randomUUID(),
		goal: "Review",
		skills: { mode: "manual", selected },
	});
	if (!started.ok) throw new Error(started.error.message);
	await vi.waitFor(() => expect(h.requests).toHaveLength(1));
	expect(runtime.load.mock.calls.map(([input]) => input.version)).toEqual(
		selected,
	);
	const stored = h.store.load(started.value.runId)?.snapshot.context;
	expect(
		stored?.skills?.contexts[0]?.snapshots.map(({ inspection, origin }) => [
			inspection.source.sourceId,
			origin,
		]),
	).toEqual(selected.map(({ sourceId }) => [sourceId, "explicit"]));
	expect(JSON.stringify(h.requests[0]?.messages)).toContain(
		"<approved-skills>",
	);
});

it("keeps the accepted run paused when a post-admission explicit load refuses", async () => {
	const { h, runtime } = setup();
	runtime.load.mockResolvedValue(err({ code: "revoked" }));
	const started = await h.threadSkills.start({
		requestId: randomUUID(),
		goal: "Review",
		skills: { mode: "manual", selected: [version(1)] },
	});
	if (!started.ok) throw new Error(started.error.message);
	await vi.waitFor(() =>
		expect(h.engine.status(started.value.runId)).toMatchObject({
			value: [{ status: "paused" }],
		}),
	);
	expect(
		h.store.load(started.value.runId)?.snapshot.context.skillBlock,
	).toEqual({ code: "revoked" });
	expect(h.requests).toEqual([]);
	expect(h.store.list()).toHaveLength(1);
});

it("drops a late explicit-load result after cancellation", async () => {
	const { h, runtime } = setup();
	const pending =
		Promise.withResolvers<Awaited<ReturnType<SkillRuntimeAdapter["load"]>>>();
	runtime.load.mockReturnValue(pending.promise);
	const started = await h.threadSkills.start({
		requestId: randomUUID(),
		goal: "Review",
		skills: { mode: "manual", selected: [version(1)] },
	});
	if (!started.ok) throw new Error(started.error.message);
	await vi.waitFor(() => expect(runtime.load).toHaveBeenCalledOnce());
	await h.engine.cancel(started.value.runId);
	pending.resolve(err({ code: "aborted" }));
	await h.stop();
	expect(h.engine.status(started.value.runId)).toMatchObject({
		value: [{ status: "cancelled" }],
	});
	expect(h.requests).toEqual([]);
});
