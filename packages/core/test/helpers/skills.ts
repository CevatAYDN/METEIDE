import { createHash, randomUUID } from "node:crypto";
import {
	checkSkillInventoryIntegrity,
	err,
	ok,
	type SkillReceipt,
	type SkillRuntimeAdapter,
	type SkillRuntimeError,
	type SkillSelectionAdapter,
	type SkillSnapshot,
	skillSnapshotCanonical,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { vi } from "vitest";

const DEFAULT_TEXT = "---\nname: review\ndescription: d\n---\nbody";

const digest = (unsigned: Omit<SkillSnapshot, "payloadSha256">) =>
	createHash("sha256").update(skillSnapshotCanonical(unsigned)).digest("hex");

/**
 * A scripted skill.runtime@1 and skill.selection@1 that keep real receipts and check them
 * with the shared contract integrity helper. `revoke` stands in for security's grant change.
 */
export const scriptedSkills = (
	registry: CapabilityRegistry,
	admission: { live: (input: never) => boolean },
	text = DEFAULT_TEXT,
	opts: { readonly selection?: boolean } = {},
) => {
	const receipts: SkillReceipt[] = [];
	const state: { revoked?: SkillRuntimeError | undefined } = {};
	const load = vi.fn<SkillRuntimeAdapter["load"]>(async (input) => {
		if (!admission.live(input as never)) return err({ code: "stale" });
		const unsigned = {
			receiptId: randomUUID(),
			owner: input.owner,
			inspection: {
				source: {
					sourceId: input.version.sourceId,
					scope: "workspace" as const,
					path: "r/SKILL.md",
				},
				text,
				sha256: input.version.sha256,
				metadata: { name: "review", description: "d" },
			},
			revision: input.version.revision,
			origin: input.origin,
			loadedAt: "2026-11-09T00:00:00.000Z",
		};
		const snapshot: SkillSnapshot = {
			...unsigned,
			payloadSha256: digest(unsigned),
		};
		receipts.push({
			...input,
			receiptId: snapshot.receiptId,
			loadedAt: snapshot.loadedAt,
			payloadSha256: snapshot.payloadSha256,
		});
		return ok(snapshot);
	});
	const check = vi.fn<SkillRuntimeAdapter["check"]>(async (input) => {
		if (state.revoked) return err(state.revoked);
		const inventory = {
			runId: input.runId,
			receipts: receipts.filter(({ owner }) => owner.runId === input.runId),
		};
		return checkSkillInventoryIntegrity(
			inventory,
			input,
			({ payloadSha256: _, ...u }) => digest(u),
		);
	});
	const inventory = vi.fn<SkillRuntimeAdapter["inventory"]>(async ({ runId }) =>
		ok({
			runId,
			receipts: receipts.filter(({ owner }) => owner.runId === runId),
		}),
	);
	const unused = async () => err({ code: "unavailable" as const });
	const core = { id: "security", trust: "core" as const, features: [] };
	registry.provide<SkillRuntimeAdapter>("skill.runtime@1", {
		...core,
		impl: { load, check, inventory, catalog: unused },
	});
	if (opts.selection !== false)
		registry.provide<SkillSelectionAdapter>("skill.selection@1", {
			...core,
			impl: { check: async () => ok(null) },
		});
	return {
		load,
		check,
		inventory,
		receipts,
		revoke: (error: SkillRuntimeError | undefined) => {
			state.revoked = error;
		},
	};
};
