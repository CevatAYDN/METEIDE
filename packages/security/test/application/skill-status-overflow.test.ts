import { err, ok, type SkillError } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { createSkillTrustAdapter } from "../../src/application/skill-trust.js";
import { mutationFixture } from "../helpers/skill-mutations.js";

const overflow = { code: "limit_exceeded" } as const;
const setup = (owner: "source" | "catalog" = "catalog") => {
	const f = mutationFixture();
	f.adapters[owner].impl.list = async () => err(overflow);
	const trust = createSkillTrustAdapter(f.options);
	const status = (signal = new AbortController().signal) =>
		trust.impl.status(signal);
	return { ...f, trust, status };
};
const decisionCount = (f: ReturnType<typeof setup>) =>
	f.db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get();

describe("overflow status retains revocable historical receipts", () => {
	it.each([true, false])(
		"returns an exact masked unavailable receipt with enabled=%s",
		async (enabled) => {
			const f = setup();
			expect(f.seed().ok).toBe(true);
			if (!enabled) {
				expect(
					f.options.update({
						source: f.inspection.source,
						sha256: f.inspection.sha256,
						enabled: false,
						expectedRevision: 1,
						at: new Date(0).toISOString(),
					}).ok,
				).toBe(true);
			}
			const before = f.options.grants.list();
			const decisions = decisionCount(f);
			const update = vi.spyOn(f.options, "update");
			const admit = vi.spyOn(f.state, "admit");
			const inspect = vi.spyOn(f.adapters.catalog.impl, "inspect");
			const read = vi.spyOn(f.adapters.source.impl, "read");
			expect(await f.status()).toEqual({
				ok: true,
				value: {
					complete: false,
					diagnostics: [overflow],
					entries: [
						{
							source: { ...f.inspection.source, path: "masked/SKILL.md" },
							revision: enabled ? 1 : 2,
							status: "unavailable",
							...(enabled ? { approvedSha256: f.inspection.sha256 } : {}),
							diagnostics: [overflow],
						},
					],
				},
			});
			expect(update).not.toHaveBeenCalled();
			expect(admit).not.toHaveBeenCalled();
			expect(inspect).not.toHaveBeenCalled();
			expect(read).not.toHaveBeenCalled();
			expect(f.options.grants.list()).toEqual(before);
			expect(decisionCount(f)).toBe(decisions);
			await f.trust.close();
		},
	);

	it.each(["source", "catalog"] as const)(
		"keeps empty history explicitly incomplete on %s overflow",
		async (owner) => {
			const f = setup(owner);
			expect(await f.status()).toEqual({
				ok: true,
				value: { entries: [], complete: false, diagnostics: [overflow] },
			});
			await f.trust.close();
		},
	);

	it("does not relax typed overflow failures for preparation or approval", async () => {
		const f = mutationFixture();
		const trust = createSkillTrustAdapter(f.options);
		const signal = new AbortController().signal;
		const input = { sourceId: f.inspection.source.sourceId };
		const preview = await trust.impl.prepare(input, signal);
		if (!preview.ok) throw new Error("Fixture preview missing");
		f.adapters.catalog.impl.list = async () => err(overflow);
		const update = vi.spyOn(f.options, "update");
		expect(await trust.impl.prepare(input, signal)).toEqual(err(overflow));
		expect(
			await trust.impl.approve({ previewId: preview.value.previewId }, signal),
		).toEqual({ admitted: true, result: err(overflow) });
		expect(update).not.toHaveBeenCalled();
		expect(f.options.grants.list()).toEqual(ok([]));
		expect(
			f.db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
		).toBe(0);
		await trust.close();
	});

	it.each([
		"bad_input",
		"unavailable",
		"stale",
		"aborted",
		"storage_failed",
	] as const)("does not fall back on %s inventory failures", async (code) => {
		const f = setup();
		f.adapters.catalog.impl.list = async () => err<SkillError>({ code });
		const list = vi.spyOn(f.options.grants, "list");
		expect(await f.status()).toEqual(err({ code }));
		expect(list).not.toHaveBeenCalled();
		await f.trust.close();
	});

	it("rejects malformed overflow failures before reading history", async () => {
		const f = setup();
		Object.assign(f.adapters.catalog.impl, {
			list: async () => ({
				ok: false,
				error: { ...overflow, message: "Unsafe adapter detail" },
			}),
		});
		const list = vi.spyOn(f.options.grants, "list");
		expect(await f.status()).toEqual(err({ code: "unavailable" }));
		expect(list).not.toHaveBeenCalled();
		await f.trust.close();
	});

	it.each([
		"throw",
		"invalid",
		"cancel",
		"source",
		"catalog",
		"masker",
	] as const)(
		"rejects %s during historical source masking",
		async (failure) => {
			const f = setup();
			expect(f.seed().ok).toBe(true);
			const controller = new AbortController();
			const mask = f.adapters.masker.impl.mask;
			const replace = (key: "source" | "catalog" | "masker") => {
				Object.assign(f.adapters[key], { impl: { ...f.adapters[key].impl } });
			};
			const faults = {
				throw: () => {
					throw new Error("Unsafe adapter detail");
				},
				invalid: () => ({ text: "", masked: 1 }),
				cancel: () => controller.abort(),
				source: () => replace("source"),
				catalog: () => replace("catalog"),
				masker: () => replace("masker"),
			};
			f.adapters.masker.impl.mask = async (text) =>
				faults[failure]() ?? mask(text);
			const code =
				failure === "cancel"
					? "aborted"
					: ["source", "catalog", "masker"].includes(failure)
						? "stale"
						: "unavailable";
			expect(await f.status(controller.signal)).toEqual(err({ code }));
			await f.trust.close();
		},
	);

	it.each(["first", "last"] as const)(
		"rejects a storage error in the %s grant read",
		async (when) => {
			const f = setup();
			const list = vi.spyOn(f.options.grants, "list");
			if (when === "last") list.mockReturnValueOnce(ok([]));
			list.mockReturnValueOnce(err({ code: "storage_failed" }));
			expect(await f.status()).toEqual(err({ code: "storage_failed" }));
			await f.trust.close();
		},
	);

	it("rejects a thrown storage read without leaking its detail", async () => {
		const f = setup();
		vi.spyOn(f.options.grants, "list").mockImplementation(() => {
			throw new Error("Unsafe storage detail");
		});
		expect(await f.status()).toEqual(err({ code: "unavailable" }));
		await f.trust.close();
	});

	it("rejects an in-place grant mutation during masking", async () => {
		const f = setup();
		expect(f.seed().ok).toBe(true);
		const listed = f.options.grants.list();
		if (!listed.ok) throw new Error("Fixture grant missing");
		vi.spyOn(f.options.grants, "list").mockReturnValue(listed);
		const mask = f.adapters.masker.impl.mask;
		f.adapters.masker.impl.mask = async (text) => {
			Object.assign(listed.value[0] ?? {}, { revision: 2, enabled: false });
			return mask(text);
		};
		expect(await f.status()).toEqual(err({ code: "stale" }));
		await f.trust.close();
	});

	it("rechecks an empty snapshot before returning incomplete history", async () => {
		const f = setup();
		expect(f.seed().ok).toBe(true);
		vi.spyOn(f.options.grants, "list").mockReturnValueOnce(ok([]));
		expect(await f.status()).toEqual(err({ code: "stale" }));
		await f.trust.close();
	});
});
