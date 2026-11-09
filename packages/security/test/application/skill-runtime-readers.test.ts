import {
	err,
	ok,
	type Result,
	type SkillError,
	type SkillTrustAdapter,
	type SkillTrustList,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	captureSkillRuntimeReaders,
	readSkillRuntimeTrust,
	type SkillRuntimeReaderOptions,
} from "../../src/application/skill-runtime-readers.js";
import { skillFixture } from "../helpers/skill-readers.js";

const signal = () => new AbortController().signal;
const failed = (code: string) => ({ ok: false, error: { code } });
const setup = () => {
	const f = skillFixture();
	const list: SkillTrustList = { entries: [], complete: true, diagnostics: [] };
	const state = { active: true, calls: 0 };
	const trust: SkillTrustAdapter = {
		status: async () => {
			state.calls++;
			return ok(list);
		},
		prepare: async () => err({ code: "unavailable" }),
		approve: async () => ({
			admitted: false,
			result: err({ code: "unavailable" }),
		}),
		disable: async () => ({
			admitted: false,
			result: err({ code: "unavailable" }),
		}),
	};
	const adapter = { ...f.adapters.source, impl: trust };
	const registration = f.options.registry.provide("skill.trust@1", adapter);
	const options = {
		...f.options,
		nativeTrust: new WeakSet([trust]),
		nativeMaskers: new WeakSet([f.adapters.masker.impl]),
		current: () => state.active,
	} satisfies SkillRuntimeReaderOptions;
	return { ...f, list, state, trust, adapter, registration, options };
};
const captured = (f: ReturnType<typeof setup>) => {
	const result = captureSkillRuntimeReaders(f.options);
	if (!result.ok) throw new Error("fixture capture failed");
	return result.value;
};

describe("native runtime skill readers", () => {
	it("captures exact implementations and returns complete empty status without masking", async () => {
		const f = setup();
		const readers = captured(f);
		expect(readers.trust).toBe(f.trust);
		expect(readers.masker).toBe(f.adapters.masker.impl);
		expect(readers.source).toBe(f.adapters.source.impl);
		expect(readers.catalog).toBe(f.adapters.catalog.impl);
		expect(readers.current()).toBe(true);
		expect(await readSkillRuntimeTrust(readers, signal())).toEqual(ok(f.list));
		expect(f.seen).toEqual([]);
	});

	it.each(["trust", "masker"] as const)(
		"refuses missing or unattested %s",
		(key) => {
			const f = setup();
			const adapter = key === "trust" ? f.adapter : f.adapters.masker;
			if (key === "trust") f.registration.dispose();
			else Object.assign(adapter, { circuit: { isOpen: () => true } });
			expect(captureSkillRuntimeReaders(f.options)).toEqual(
				failed("unavailable"),
			);
			if (key === "trust")
				f.options.registry.provide("skill.trust@1", f.adapter);
			else Object.assign(adapter, { circuit: { isOpen: () => false } });
			if (key === "trust") f.options.nativeTrust.delete(f.trust);
			else f.options.nativeMaskers.delete(f.adapters.masker.impl);
			expect(captureSkillRuntimeReaders(f.options)).toEqual(
				failed("unavailable"),
			);
			expect(f.state.calls).toBe(0);
		},
	);

	it.each(["trust", "masker"] as const)(
		"never falls back from replaced %s before capture",
		(key) => {
			const f = setup();
			const adapter = key === "trust" ? f.adapter : f.adapters.masker;
			const ref = key === "trust" ? "skill.trust@1" : "secrets.mask@1";
			f.options.registry.provide<unknown>(ref, { ...adapter, id: "fallback" });
			Object.assign(adapter, { impl: { ...adapter.impl } });
			expect(captureSkillRuntimeReaders(f.options)).toEqual(
				failed("unavailable"),
			);
			expect(f.state.calls).toBe(0);
		},
	);

	it.each([
		"source",
		"catalog",
		"masker",
		"trust",
		"runtime",
		"trustAttestation",
		"maskerAttestation",
	] as const)("refuses %s replacement while status awaits", async (key) => {
		const f = setup();
		const readers = captured(f);
		const pending = Promise.withResolvers<Result<SkillTrustList, SkillError>>();
		f.trust.status = () => pending.promise;
		const result = readSkillRuntimeTrust(readers, signal());
		if (key === "runtime") f.state.active = false;
		else if (key === "trustAttestation") f.options.nativeTrust.delete(f.trust);
		else if (key === "maskerAttestation")
			f.options.nativeMaskers.delete(f.adapters.masker.impl);
		else {
			const adapter = key === "trust" ? f.adapter : f.adapters[key];
			Object.assign(adapter, { impl: { ...adapter.impl } });
		}
		pending.resolve(ok(f.list));
		expect(await result).toEqual(failed("stale"));
		expect(readers.current()).toBe(false);
	});

	it.each(["trust", "masker"] as const)(
		"retains exact %s registry descriptor identity",
		async (key) => {
			const f = setup();
			const readers = captured(f);
			const adapter = key === "trust" ? f.adapter : f.adapters.masker;
			f.trust.status = async () => {
				Object.assign(adapter, { circuit: { isOpen: () => true } });
				f.options.registry.provide<unknown>(
					key === "trust" ? "skill.trust@1" : "secrets.mask@1",
					{ ...adapter, id: "replacement", circuit: { isOpen: () => false } },
				);
				return ok(f.list);
			};
			expect(await readSkillRuntimeTrust(readers, signal())).toEqual(
				failed("stale"),
			);
		},
	);

	it.each(["runtime", "reader", "attestation"] as const)(
		"makes %s failures exception-safe",
		(key) => {
			const f = setup();
			f.state.active = false;
			expect(captureSkillRuntimeReaders(f.options)).toEqual(
				failed("unavailable"),
			);
			f.state.active = true;
			const readers = captured(f);
			const fail = () => {
				throw new Error("secret raw failure");
			};
			if (key === "runtime") f.options.current = fail;
			if (key === "reader")
				Object.assign(f.adapters.source, { circuit: { isOpen: fail } });
			if (key === "attestation") f.options.nativeTrust.has = fail;
			expect(readers.current()).toBe(false);
			expect(captureSkillRuntimeReaders(f.options)).toEqual(
				failed("unavailable"),
			);
		},
	);

	it("honors cancellation before and after the status await", async () => {
		const f = setup();
		const readers = captured(f);
		const before = new AbortController();
		before.abort();
		expect(await readSkillRuntimeTrust(readers, before.signal)).toEqual(
			failed("aborted"),
		);
		expect(f.state.calls).toBe(0);
		const after = new AbortController();
		f.trust.status = async () => {
			after.abort();
			return ok(f.list);
		};
		expect(await readSkillRuntimeTrust(readers, after.signal)).toEqual(
			failed("aborted"),
		);
	});

	it.each([
		[{}, "unavailable"],
		[{ ok: true, value: {} }, "unavailable"],
		[ok({ entries: [{}], complete: true, diagnostics: [] }), "unavailable"],
		[
			{
				ok: true,
				value: { entries: [], complete: true, diagnostics: [] },
				text: "secret",
			},
			"unavailable",
		],
		[err({ code: "unavailable", message: "secret" }), "unavailable"],
		[err({ code: "revoked" }), "unavailable"],
		[err({ code: "storage_failed" }), "storage_failed"],
	] as const)("validates the full S1 Result envelope %#", async (raw, code) => {
		const f = setup();
		Object.assign(f.trust, { status: async () => raw });
		expect(await readSkillRuntimeTrust(captured(f), signal())).toEqual(
			failed(code),
		);
	});

	it.each([
		[[], "unavailable"],
		[[{ code: "unavailable" }], "unavailable"],
		[[{ code: "limit_exceeded" }], "limit_exceeded"],
	] as const)("refuses incomplete status %#", async (diagnostics, code) => {
		const f = setup();
		f.list.complete = false;
		f.list.diagnostics = [...diagnostics];
		expect(await readSkillRuntimeTrust(captured(f), signal())).toEqual(
			failed(code),
		);
	});

	it("preserves complete entries and recognizes their incomplete limit diagnostics", async () => {
		const f = setup();
		const entry: SkillTrustList["entries"][number] = {
			source: f.inspection.source,
			status: "unapproved",
			revision: 0,
			diagnostics: [],
		};
		f.list.entries = [entry];
		expect(await readSkillRuntimeTrust(captured(f), signal())).toEqual(
			ok(f.list),
		);
		f.list.complete = false;
		entry.diagnostics = [{ code: "limit_exceeded" }];
		expect(await readSkillRuntimeTrust(captured(f), signal())).toEqual(
			failed("limit_exceeded"),
		);
	});

	it("does not forward a rejected status call's raw exception", async () => {
		const f = setup();
		f.trust.status = async () => {
			throw new Error("secret body and root");
		};
		expect(await readSkillRuntimeTrust(captured(f), signal())).toEqual(
			failed("unavailable"),
		);
	});
});
