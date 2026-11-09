import { err, ok, SKILL_LIMITS } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { descriptor, hash, setup, snapshot } from "./helpers/skill-catalog.js";

const signal = new AbortController().signal;
const input = { sourceId: hash("workspace") };
const unavailable = { ok: false, error: { code: "unavailable" } };

const invalidSnapshots = () => {
	const original = snapshot(descriptor("workspace"));
	const text = "private marker";
	return [
		["malformed", { ...original, text: 42 }, "unavailable"],
		["identity", snapshot(descriptor("global")), "stale"],
		["digest", { ...original, sha256: hash("other bytes") }, "bad_input"],
		["frontmatter", { ...original, text, sha256: hash(text) }, "bad_input"],
	] as const;
};

const changeOwner = (fixture: ReturnType<typeof setup>, mutation: string) => {
	const { source, registry, adapter, nativeSources } = fixture;
	if (mutation === "attestation") nativeSources.delete(source);
	else if (mutation === "impl")
		Object.assign(adapter, { impl: setup().source });
	else {
		fixture.registration.dispose();
		registry.provide("skill.source@1", { ...adapter });
	}
};

describe("catalog boundary and ownership regressions", () => {
	it("distinguishes empty, failed, ignored and incomplete inventory", async () => {
		const { catalog, source } = setup([]);
		expect(await catalog.list(signal)).toEqual(
			ok({
				entries: [],
				complete: true,
				diagnostics: [],
			}),
		);
		expect(await catalog.inspect(input, signal)).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
		vi.spyOn(source, "list").mockResolvedValue(
			err({
				code: "unavailable",
				location: "root",
			}),
		);
		expect(await catalog.list(signal)).toEqual(
			err({
				code: "unavailable",
				location: "root",
			}),
		);
		vi.spyOn(source, "list").mockResolvedValue(
			ok({
				sources: [],
				complete: true,
				diagnostics: [{ code: "ignored", sourceId: input.sourceId }],
			}),
		);
		vi.spyOn(source, "read").mockResolvedValue(
			err({ code: "ignored", sourceId: input.sourceId }),
		);
		expect(await catalog.inspect(input, signal)).toEqual(
			err({ code: "ignored", sourceId: input.sourceId }),
		);
		vi.spyOn(source, "list").mockResolvedValue(
			ok({
				sources: [],
				complete: false,
				diagnostics: [],
			}),
		);
		vi.spyOn(source, "read").mockResolvedValue(err({ code: "unavailable" }));
		expect(await catalog.inspect(input, signal)).toMatchObject(unavailable);
	});
	it.each([
		null,
		{ ok: true },
		{ ok: true, value: {} },
		ok({
			sources: [descriptor("workspace"), descriptor("workspace")],
			complete: true,
			diagnostics: [],
		}),
		ok({
			sources: [],
			complete: true,
			diagnostics: [{ code: "limit_exceeded", location: "root" }],
		}),
		{ ok: false, error: { code: "unavailable", message: "private marker" } },
	])("refuses malformed source Results: %j", async (raw) => {
		const { catalog, source } = setup();
		Object.assign(source, { list: async () => raw });
		expect(await catalog.list(signal)).toMatchObject(unavailable);
	});
	it.each(["list", "read"])("refuses thrown %s failures", async (method) => {
		const { catalog, source } = setup();
		expect(
			await catalog.inspect({ sourceId: "invalid" }, signal),
		).toMatchObject({ ok: false, error: { code: "bad_input" } });
		expect(source.list).not.toHaveBeenCalled();
		Object.assign(source, {
			[method]: async () => {
				throw new Error("private marker");
			},
		});
		expect(await catalog.list(signal)).toEqual(
			err({
				code: "unavailable",
				location: "source",
			}),
		);
	});
	it.each(invalidSnapshots())(
		"retains source-qualified diagnostics for %s snapshots",
		async (_kind, raw, code) => {
			const { catalog, source } = setup();
			Object.assign(source, { read: async () => ok(raw) });
			const listed = await catalog.list(signal);
			expect(listed).toMatchObject({
				ok: true,
				value: {
					entries: [],
					diagnostics: [{ code, sourceId: input.sourceId }],
				},
			});
			expect(JSON.stringify(listed)).not.toContain("private marker");
			expect(await catalog.inspect(input, signal)).toMatchObject({
				ok: false,
				error: { code, sourceId: input.sourceId },
			});
		},
	);
	it("limits discovery while inspecting only the requested source", async () => {
		const sources = Array.from(
			{ length: SKILL_LIMITS.catalogEntries + 1 },
			(_, i) => descriptor("workspace", `skill-${i}`, hash(String(i))),
		);
		const { catalog, source } = setup(sources);
		const limit = { ok: false, error: { code: "limit_exceeded" } };
		expect(await catalog.list(signal)).toMatchObject(limit);
		const first = sources[0];
		if (!first) throw new Error("limit fixture missing");
		vi.mocked(source.read).mockClear();
		vi.mocked(source.list).mockClear();
		expect(
			await catalog.inspect({ sourceId: first.sourceId }, signal),
		).toMatchObject({ ok: true, value: { source: first } });
		expect(source.read).toHaveBeenCalledOnce();
		expect(source.list).not.toHaveBeenCalled();
		const full = await setup(sources.slice(0, -1)).catalog.list(signal);
		expect(full.ok && full.value.entries).toHaveLength(
			SKILL_LIMITS.catalogEntries,
		);
	});
	it.each(["list", "read"] as const)(
		"rechecks ownership after %s",
		async (method) => {
			for (const mutation of ["replacement", "impl", "attestation"]) {
				const fixture = setup();
				const { catalog, source } = fixture;
				Object.assign(source, {
					[method]: async () => {
						await Promise.resolve();
						changeOwner(fixture, mutation);
						return method === "list"
							? ok({ sources: [], complete: true, diagnostics: [] })
							: ok(snapshot(descriptor("workspace")));
					},
				});
				expect(await catalog.list(signal)).toMatchObject(unavailable);
			}
		},
	);
	it("resolves replacements per request and honors cancellation", async () => {
		const fixture = setup();
		const { catalog, source, registry, registration, adapter, nativeSources } =
			fixture;
		expect((await catalog.list(signal)).ok).toBe(true);
		registration.dispose();
		const replacement = setup([]).source;
		nativeSources.add(replacement);
		registry.provide("skill.source@1", { ...adapter, impl: replacement });
		expect(await catalog.list(signal)).toEqual(
			ok({
				entries: [],
				complete: true,
				diagnostics: [],
			}),
		);
		expect(source.list).toHaveBeenCalledTimes(1);
		const controller = new AbortController();
		Object.assign(replacement, {
			list: async () => {
				controller.abort();
				return ok({ sources: [], complete: true, diagnostics: [] });
			},
		});
		expect(await catalog.list(controller.signal)).toMatchObject({
			ok: false,
			error: { code: "aborted" },
		});
	});
	it("returns fresh bytes after an earlier inventory, without rereading other sources", async () => {
		const { catalog, source } = setup();
		const original = snapshot(descriptor("workspace"));
		const text = `${original.text}\nNew instructions.`;
		const fresh = { ...original, text, sha256: hash(text) };
		let reads = 0;
		vi.spyOn(source, "read").mockImplementation(async () =>
			ok(++reads === 1 ? original : fresh),
		);
		expect((await catalog.list(signal)).ok).toBe(true);
		expect(await catalog.inspect(input, signal)).toEqual(
			ok({
				...fresh,
				metadata: { name: "example", description: "Local review" },
			}),
		);
		expect(source.read).toHaveBeenCalledTimes(2);
		expect(source.list).toHaveBeenCalledOnce();
	});
	it("does not succeed when cancellation occurs during a read", async () => {
		const { catalog, source } = setup();
		const controller = new AbortController();
		vi.spyOn(source, "read").mockImplementation(async () => {
			controller.abort();
			return ok(snapshot(descriptor("workspace")));
		});
		expect(await catalog.inspect(input, controller.signal)).toMatchObject({
			ok: false,
			error: { code: "aborted" },
		});
	});
	it("keeps the inventory descriptor stable across a mutated read", async () => {
		const shared = descriptor("workspace");
		const { catalog, source } = setup([shared]);
		vi.spyOn(source, "read").mockImplementation(async () => {
			await Promise.resolve();
			Object.assign(shared, { scope: "global" });
			return ok(snapshot(shared));
		});
		expect(await catalog.list(signal)).toMatchObject({
			ok: true,
			value: {
				entries: [],
				diagnostics: [{ code: "stale", sourceId: input.sourceId }],
			},
		});
	});
	it("qualifies read refusals with the requested source identity", async () => {
		const { catalog, source } = setup();
		vi.spyOn(source, "read").mockResolvedValue(
			err({
				code: "ignored",
				sourceId: hash("different source"),
			}),
		);
		expect(await catalog.list(signal)).toEqual(
			ok({
				entries: [],
				complete: true,
				diagnostics: [{ code: "ignored", sourceId: input.sourceId }],
			}),
		);
	});
});
