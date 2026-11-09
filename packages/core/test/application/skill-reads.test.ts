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

/** A paused S2 single-agent run with one authentic loaded snapshot. */
const loadedRun = async () => {
	const h = engineHarness({ scripts: [slow] });
	open.push(h);
	const skills = scriptedSkills(h.registry, h.skillLoadAdmission);
	const started = await h.threadSkills.start({
		requestId: randomUUID(),
		goal: "hello",
		skills: { mode: "manual", selected: [version] },
	});
	if (!started.ok) throw new Error(started.error.message);
	const { runId } = started.value;
	await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(0));
	const owner =
		h.store.load(runId)?.snapshot.context.skills?.contexts[0]?.owner;
	if (!owner) throw new Error("no S2 context");
	const loaded = await h.loadSkill(runId, {
		owner,
		roleId: "assistant",
		version,
		origin: "explicit",
	});
	if (!loaded.ok) throw new Error(loaded.error.code);
	await h.engine.pause(runId);
	return { h, skills, runId, owner, receiptId: loaded.value.receiptId };
};

describe("run.skills@1 read", () => {
	it("summarizes authenticated metadata without bodies", async () => {
		const { h, runId, receiptId } = await loadedRun();
		const read = await h.runSkills.read({ runId });
		if (!read.ok) throw new Error(read.error.code);
		expect(read.value).toMatchObject({
			kind: "summary",
			contexts: [
				{ status: "loaded", loaded: [{ receiptId, origin: "explicit" }] },
			],
		});
		expect(JSON.stringify(read.value)).not.toContain("body");
	});

	it("returns the exact retained snapshots only for a named context", async () => {
		const { h, runId, owner } = await loadedRun();
		const read = await h.runSkills.read({ runId, contextId: owner.contextId });
		if (!read.ok) throw new Error(read.error.code);
		expect(read.value.kind).toBe("context");
		expect(JSON.stringify(read.value)).toContain("body");
	});

	it("refuses an issued receipt that core did not retain instead of reporting empty", async () => {
		const { h, skills, runId, owner } = await loadedRun();
		// A receipt-only crash: security issued it, core never saved the snapshot.
		skills.receipts.push({
			...(skills.receipts[0] as (typeof skills.receipts)[number]),
			receiptId: randomUUID(),
			operationId: randomUUID(),
			owner: { ...owner, contextId: randomUUID() },
		});
		expect(await h.runSkills.read({ runId })).toEqual(
			err({ code: "integrity_failed" }),
		);
	});

	it("reports an unavailable inventory as an error, not as empty", async () => {
		const { h, skills, runId } = await loadedRun();
		skills.inventory.mockResolvedValueOnce(err({ code: "storage_failed" }));
		expect(await h.runSkills.read({ runId })).toEqual(
			err({ code: "storage_failed" }),
		);
	});

	it("announces content-free refresh events on load and on block", async () => {
		const { h, skills, runId, owner } = await loadedRun();
		const updates = () =>
			h.events.filter((e) => e.type === "run.skills.updated");
		expect(updates().map((e) => e.payload)).toEqual([
			{ contextId: owner.contextId },
		]);
		expect(JSON.stringify(updates())).not.toContain("body");
		skills.revoke({ code: "revoked", sourceId: version.sourceId });
		await h.engine.resume(runId);
		expect(updates()).toHaveLength(2);
	});

	it("still shows authentic history and the block after revocation", async () => {
		const { h, skills, runId } = await loadedRun();
		skills.revoke({ code: "revoked", sourceId: version.sourceId });
		await h.engine.resume(runId);
		const read = await h.runSkills.read({ runId });
		if (!read.ok) throw new Error(read.error.code);
		expect(read.value).toMatchObject({
			kind: "summary",
			block: { code: "revoked" },
			contexts: [{ status: "blocked", loaded: [{ origin: "explicit" }] }],
		});
	});

	it("reads genuine legacy runs as legacy without asking security", async () => {
		const h = engineHarness({ scripts: [slow] });
		open.push(h);
		const skills = scriptedSkills(h.registry, h.skillLoadAdmission);
		const started = await h.thread.start({
			requestId: randomUUID(),
			goal: "hi",
		});
		if (!started.ok) throw new Error(started.error.message);
		expect(await h.runSkills.read({ runId: started.value.runId })).toEqual({
			ok: true,
			value: { kind: "legacy", runId: started.value.runId },
		});
		expect(skills.inventory).not.toHaveBeenCalled();
	});

	it("does not reveal another run or a missing context", async () => {
		const { h, runId } = await loadedRun();
		expect(await h.runSkills.read({ runId: randomUUID() })).toEqual(
			err({ code: "not_found" }),
		);
		expect(await h.runSkills.read({ runId, contextId: randomUUID() })).toEqual(
			err({ code: "not_found" }),
		);
	});
});
