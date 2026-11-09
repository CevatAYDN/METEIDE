import { err, ok, type SkillTrustEntry } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { checkSkillSelection } from "../../src/application/skill-selection.js";
import { skillRuntimeFixture } from "../helpers/skill-runtime.js";

const signal = () => new AbortController().signal;
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};
const grant = (over: Partial<SkillTrustEntry> = {}): SkillTrustEntry => ({
	source: { sourceId: "a".repeat(64), scope: "workspace", path: "x/SKILL.md" },
	status: "approved",
	revision: 1,
	approvedSha256: "b".repeat(64),
	currentSha256: "b".repeat(64),
	metadata: { name: "secret", description: "secret" },
	diagnostics: [],
	...over,
});
const ready = () => {
	const f = skillRuntimeFixture();
	f.status.entries = [grant()];
	return f;
};
const check = (f: ReturnType<typeof ready>, selected = [version]) =>
	checkSkillSelection(f.options, { selected }, signal());

describe("skill.selection@1 preflight", () => {
	it("accepts an exact enabled version and returns no content", async () => {
		const f = ready();
		expect(await check(f)).toEqual(ok(null));
		expect(f.management).not.toHaveBeenCalled();
	});

	it("accepts an empty selection without any discovery", async () => {
		const f = ready();
		f.options.nativeTrust.delete(f.trust);
		expect(await check(f, [])).toEqual(ok(null));
		expect(f.trust.status).not.toHaveBeenCalled();
		expect(f.seen).toEqual([]);
	});

	it("refuses duplicate sources and too many versions as bad input", async () => {
		const f = ready();
		expect(await check(f, [version, version])).toEqual(
			err({ code: "bad_input" }),
		);
		const many = Array.from({ length: 5 }, (_, n) => ({
			...version,
			sourceId: n.toString(16).padStart(64, "0"),
		}));
		expect(await check(f, many)).toEqual(err({ code: "bad_input" }));
	});

	it.each([
		["disabled", grant({ status: "disabled" })],
		["stale revision", grant({ revision: 2 })],
		[
			"changed digest",
			grant({ approvedSha256: "c".repeat(64), currentSha256: "c".repeat(64) }),
		],
	])("refuses a %s grant as revoked", async (_name, entry) => {
		const f = ready();
		f.status.entries = [entry];
		expect(await check(f)).toEqual(
			err({ code: "revoked", sourceId: version.sourceId }),
		);
	});

	it("refuses an unknown source and an incomplete inventory", async () => {
		const f = ready();
		f.status.entries = [];
		expect(await check(f)).toEqual(
			err({ code: "not_found", sourceId: version.sourceId }),
		);
		const g = ready();
		g.sourceList.complete = false;
		expect(await check(g)).toEqual(err({ code: "unavailable" }));
	});

	it("refuses when raw bytes no longer match the selected digest", async () => {
		const f = ready();
		f.inspection.sha256 = "d".repeat(64);
		expect(await check(f)).toEqual(
			err({ code: "integrity_failed", sourceId: version.sourceId }),
		);
	});

	it("counts the full masked text and refuses an aggregate over budget", async () => {
		const f = ready();
		const second = { ...version, sourceId: "e".repeat(64) };
		const source = { ...grant().source, sourceId: second.sourceId };
		f.status.entries.push(grant({ source }));
		f.sourceList.sources.push({
			...f.inspection.source,
			sourceId: second.sourceId,
		});
		const body = `---\nname: secret\n---\n${"x".repeat(40_000)}`;
		f.adapters.catalog.impl.inspect = async ({ sourceId }) =>
			ok({
				...f.inspection,
				source: { ...f.inspection.source, sourceId },
				text: body,
			});
		expect(await check(f, [version])).toEqual(ok(null));
		expect(await check(f, [version, second])).toEqual(
			err({ code: "budget_exceeded" }),
		);
		expect(f.seen.filter((text) => text.length > 40_000)).toHaveLength(3);
	});

	it("rechecks grants after masking and refuses a concurrent disable", async () => {
		const f = ready();
		f.trust.status
			.mockResolvedValueOnce(ok(f.status))
			.mockResolvedValueOnce(
				ok({ ...f.status, entries: [grant({ status: "disabled" })] }),
			);
		expect(await check(f)).toEqual(
			err({ code: "revoked", sourceId: version.sourceId }),
		);
		expect(f.trust.status).toHaveBeenCalledTimes(2);
	});

	it.each(["aborted", "stale"] as const)(
		"keeps a late %s result as an error",
		async (code) => {
			const f = ready();
			const controller = new AbortController();
			const inspect = vi.fn(async () => {
				if (code === "aborted") controller.abort();
				else f.lifecycle.current = false;
				return ok(f.inspection);
			});
			f.adapters.catalog.impl.inspect = inspect;
			expect(
				await checkSkillSelection(
					f.options,
					{ selected: [version] },
					controller.signal,
				),
			).toEqual(err({ code }));
		},
	);

	it("refuses missing native trust evidence", async () => {
		const f = ready();
		f.options.nativeTrust.delete(f.trust);
		expect(await check(f)).toEqual(err({ code: "unavailable" }));
		expect(f.trust.status).not.toHaveBeenCalled();
	});
});
