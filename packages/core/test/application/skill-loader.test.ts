import { createHash, randomUUID } from "node:crypto";
import {
	err,
	ok,
	type SkillRuntimeAdapter,
	type SkillRuntimeLoadInput,
	type SkillSnapshot,
	skillSnapshotCanonical,
} from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { createSkillLoadAuthority } from "../../src/application/skill-load-authority.js";
import {
	loadSkill,
	type SkillLoadHost,
} from "../../src/application/skill-loader.js";
import type { RunSkillState } from "../../src/domain/skill-state.js";

const runId = randomUUID();
const owner = { runId, contextId: randomUUID() };
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};
const req = { owner, roleId: "assistant", version, origin: "model" as const };
const TEXT = "---\nname: review\ndescription: d\n---\nbody";

const snapshotFor = (input: SkillRuntimeLoadInput): SkillSnapshot => {
	const unsigned = {
		receiptId: randomUUID(),
		owner: input.owner,
		inspection: {
			source: {
				sourceId: input.version.sourceId,
				scope: "workspace" as const,
				path: "r/SKILL.md",
			},
			text: TEXT,
			sha256: input.version.sha256,
			metadata: { name: "review", description: "d" },
		},
		revision: input.version.revision,
		origin: input.origin,
		loadedAt: "2026-11-09T00:00:00.000Z",
	};
	return {
		...unsigned,
		payloadSha256: createHash("sha256")
			.update(skillSnapshotCanonical(unsigned))
			.digest("hex"),
	};
};

/** A host over in-memory state; the scripted runtime honors native admission like security. */
const host = () => {
	const authority = createSkillLoadAuthority();
	const state: { skills: RunSkillState; owned: boolean; saved: number } = {
		skills: {
			runId,
			policy: { mode: "auto", roles: [{ roleId: "assistant", selected: [] }] },
			contexts: [{ owner, roleId: "assistant", snapshots: [] }],
		},
		owned: true,
		saved: 0,
	};
	const issued: SkillRuntimeLoadInput[] = [];
	const load = vi.fn<SkillRuntimeAdapter["load"]>(async (input) => {
		if (!authority.admission.live(input)) return err({ code: "stale" });
		if (!authority.admission.fits(input, new TextEncoder().encode(TEXT).length))
			return err({ code: "budget_exceeded" });
		issued.push(input);
		return ok(snapshotFor(input));
	});
	const unused = async () => err({ code: "unavailable" as const });
	const runtime: SkillRuntimeAdapter = {
		load,
		inventory: unused,
		catalog: unused,
		check: unused,
	};
	const h: SkillLoadHost = {
		runtime: () => runtime,
		authority,
		skills: () => state.skills,
		owned: () => state.owned,
		commit: (next) => {
			if (!state.owned) return false;
			state.skills = next;
			state.saved++;
			return true;
		},
		newId: randomUUID,
		signal: new AbortController().signal,
	};
	return { h, state, load, issued, authority };
};

describe("native skill loading coordinator", () => {
	it("persists the snapshot before acknowledging with metadata only", async () => {
		const { h, state, issued, authority } = host();
		const result = await loadSkill(h, req);
		if (!result.ok) throw new Error(result.error.code);
		expect(Object.keys(result.value).sort()).toEqual([
			"loadedAt",
			"origin",
			"receiptId",
			"version",
		]);
		expect(state.saved).toBe(1);
		expect(state.skills.contexts[0]?.snapshots[0]?.receiptId).toBe(
			result.value.receiptId,
		);
		expect(authority.admission.live(issued[0] as SkillRuntimeLoadInput)).toBe(
			false,
		);
	});

	it("reuses a retained exact version without a second receipt", async () => {
		const { h, load } = host();
		const first = await loadSkill(h, req);
		expect(await loadSkill(h, req)).toEqual(first);
		expect(load).toHaveBeenCalledOnce();
	});

	it("refuses when ownership already ended, without calling security", async () => {
		const { h, state, load } = host();
		state.owned = false;
		expect(await loadSkill(h, req)).toEqual(err({ code: "stale" }));
		expect(load).not.toHaveBeenCalled();
	});

	it("does not activate a load that finishes after ownership ended", async () => {
		const { h, state, load } = host();
		const gate = Promise.withResolvers<void>();
		const original = load.getMockImplementation();
		load.mockImplementationOnce(async (input, signal) => {
			const result = original ? await original(input, signal) : undefined;
			await gate.promise;
			return result ?? err({ code: "unavailable" });
		});
		const pending = loadSkill(h, req);
		await vi.waitFor(() => expect(load).toHaveBeenCalled());
		state.owned = false;
		gate.resolve();
		expect(await pending).toEqual(err({ code: "stale" }));
		expect(state.skills.contexts[0]?.snapshots).toEqual([]);
	});

	it("refuses before a receipt when the retained context is full", async () => {
		const { h, state, load, issued } = host();
		const full = Array.from({ length: 4 }, (_, n) =>
			snapshotFor({
				owner,
				operationId: randomUUID(),
				origin: "model",
				version: { ...version, sourceId: n.toString(16).padStart(64, "0") },
			}),
		);
		state.skills = {
			...state.skills,
			contexts: [{ owner, roleId: "assistant", snapshots: full }],
		};
		expect(await loadSkill(h, req)).toEqual(err({ code: "budget_exceeded" }));
		expect(load).toHaveBeenCalledOnce();
		expect(issued).toEqual([]);
	});

	it("reports storage_failed when the durable save throws", async () => {
		const { h } = host();
		const failing: SkillLoadHost = {
			...h,
			commit: () => {
				throw new Error("disk");
			},
		};
		expect(await loadSkill(failing, req)).toEqual(
			err({ code: "storage_failed" }),
		);
	});

	it("reports unavailable without a runtime and integrity_failed without S2 state", async () => {
		const { h } = host();
		expect(await loadSkill({ ...h, runtime: () => undefined }, req)).toEqual(
			err({ code: "unavailable" }),
		);
		expect(await loadSkill({ ...h, skills: () => undefined }, req)).toEqual(
			err({ code: "integrity_failed" }),
		);
	});

	it("rejects a malformed runtime result instead of trusting it", async () => {
		const { h, load, state } = host();
		load.mockResolvedValueOnce({
			ok: true,
			value: { receiptId: "x" },
		} as never);
		expect(await loadSkill(h, req)).toEqual(err({ code: "unavailable" }));
		expect(state.saved).toBe(0);
	});
});
