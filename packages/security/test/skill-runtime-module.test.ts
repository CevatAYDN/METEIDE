import { mkdir } from "node:fs/promises";
import type {
	SkillRuntimeAdapter,
	SkillSelectionAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { setup } from "./setup.js";

const open: Array<{ storage: { deactivate?: () => Promise<void> | void } }> =
	[];
afterEach(async () => {
	for (const s of open.splice(0)) await s.storage.deactivate?.();
});

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const signal = () => new AbortController().signal;
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};

const activated = async () => {
	const s = await setup();
	open.push(s);
	await mkdir(s.dirs.workspaceDir, { recursive: true });
	const result = await s.security.activate(s.ctx);
	if (!result.ok) throw new Error(result.error.message);
	const resolve = <C>(ref: "skill.runtime@1" | "skill.selection@1") => {
		const r = s.registry.resolve<C>(ref);
		if (!r.ok) throw new Error(`${ref} missing`);
		return r.value[0].impl;
	};
	return {
		...s,
		runtime: resolve<SkillRuntimeAdapter>("skill.runtime@1"),
		selection: resolve<SkillSelectionAdapter>("skill.selection@1"),
	};
};

describe("security skill runtime registration", () => {
	it("serves a complete empty inventory without optional skill modules", async () => {
		const s = await activated();
		expect(await s.runtime.inventory({ runId: id(1) }, signal())).toEqual({
			ok: true,
			value: { runId: id(1), receipts: [] },
		});
		expect(await s.selection.check({ selected: [] }, signal())).toEqual({
			ok: true,
			value: null,
		});
	});

	it("fails closed without native attestations instead of an empty success", async () => {
		const s = await activated();
		expect(await s.runtime.catalog(signal())).toEqual({
			ok: true,
			value: {
				status: "unavailable",
				entries: [],
				diagnostics: [{ code: "unavailable" }],
			},
		});
		expect(await s.selection.check({ selected: [version] }, signal())).toEqual({
			ok: false,
			error: { code: "unavailable" },
		});
		const load = await s.runtime.load(
			{
				owner: { runId: id(1), contextId: id(2) },
				operationId: id(3),
				version,
				origin: "explicit",
			},
			signal(),
		);
		expect(load).toEqual({ ok: false, error: { code: "stale" } });
	});

	it("retires the captured runtime when the module deactivates", async () => {
		const s = await activated();
		await s.security.deactivate?.();
		expect(s.registry.has("skill.runtime@1")).toBe(false);
		expect(await s.runtime.inventory({ runId: id(1) }, signal())).toEqual({
			ok: false,
			error: { code: "stale" },
		});
		expect(await s.selection.check({ selected: [] }, signal())).toEqual({
			ok: false,
			error: { code: "stale" },
		});
	});
});
