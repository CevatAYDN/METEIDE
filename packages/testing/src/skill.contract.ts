import {
	type Result,
	type SkillCatalogAdapter,
	SkillCatalogListSchema,
	type SkillError,
	SkillErrorSchema,
	type SkillInspection,
	SkillInspectionSchema,
	SkillMutationResultSchema,
	SkillPreviewSchema,
	type SkillSourceAdapter,
	SkillSourceListSchema,
	type SkillSourceSnapshot,
	SkillSourceSnapshotSchema,
	type SkillTrustAdapter,
	SkillTrustListSchema,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

/** Fresh isolated valid source; snapshot is independently expected, not adapter output. */
export type SkillFixture<Adapter> = {
	readonly adapter: Adapter;
	readonly sourceId: string;
	readonly snapshot: SkillSourceSnapshot;
	readonly close: () => Promise<void>;
};
/** Opens a working skill.source@1 fixture with caller-owned native or stub dependencies. */
export type SkillSourceHarness = () => Promise<
	SkillFixture<SkillSourceAdapter>
>;
/** Opens a working skill.catalog@1 fixture containing the supplied valid source. */
export type SkillCatalogHarness = () => Promise<
	SkillFixture<SkillCatalogAdapter>
>;
/** Starts unapproved, admits valid mutations, and supplies independently expected masking. */
export type SkillTrustHarness = () => Promise<
	SkillFixture<SkillTrustAdapter> & {
		readonly maskedInspection: SkillInspection;
	}
>;

const signal = () => new AbortController().signal;
const value = <T>(result: Result<T, SkillError>): T => {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.error.code);
	return result.value;
};
const badInput = (result: Result<unknown, SkillError>) =>
	expect(result.ok ? "ok" : SkillErrorSchema.parse(result.error).code).toBe(
		"bad_input",
	);
const fixtures = <T extends SkillFixture<unknown>>(open: () => Promise<T>) => {
	let close: (() => Promise<void>) | undefined;
	afterEach(async () => {
		await close?.();
		close = undefined;
	});
	return async () => {
		const fixture = await open();
		close = fixture.close;
		const expected = SkillSourceSnapshotSchema.parse(fixture.snapshot);
		expect(expected.source.sourceId).toBe(fixture.sourceId);
		return fixture;
	};
};

/** Every skill.source@1 adapter must preserve complete source-qualified byte snapshots. */
export const skillSourceContract = (name: string, open: SkillSourceHarness) =>
	describe(`skill.source@1 contract: ${name}`, () => {
		const setup = fixtures(open);
		it("lists the valid source and reads its complete exact snapshot", async () => {
			const h = await setup();
			const listed = SkillSourceListSchema.parse(
				value(await h.adapter.list(signal())),
			);
			expect(listed.complete).toBe(true);
			expect(listed.sources).toContainEqual(h.snapshot.source);
			const read = value(
				await h.adapter.read({ sourceId: h.sourceId }, signal()),
			);
			expect(SkillSourceSnapshotSchema.parse(read)).toEqual(h.snapshot);
		});
		it("refuses an invalid source ID instead of returning empty success", async () => {
			const h = await setup();
			badInput(await h.adapter.read({ sourceId: "not-a-source-id" }, signal()));
		});
	});

/** Every skill.catalog@1 adapter must inspect the requested source without truncation. */
export const skillCatalogContract = (name: string, open: SkillCatalogHarness) =>
	describe(`skill.catalog@1 contract: ${name}`, () => {
		const setup = fixtures(open);
		it("lists valid metadata and inspects the same complete raw snapshot", async () => {
			const h = await setup();
			const listed = SkillCatalogListSchema.parse(
				value(await h.adapter.list(signal())),
			);
			expect(listed.complete).toBe(true);
			const entry = listed.entries.find(
				({ source }) => source.sourceId === h.sourceId,
			);
			expect(entry).toBeDefined();
			expect(entry?.source).toEqual(h.snapshot.source);
			const inspected = SkillInspectionSchema.parse(
				value(await h.adapter.inspect({ sourceId: h.sourceId }, signal())),
			);
			expect(inspected).toMatchObject(h.snapshot);
			expect(inspected.metadata).toEqual(entry?.metadata);
		});
		it("refuses an invalid source ID instead of returning an empty inspection", async () => {
			const h = await setup();
			badInput(
				await h.adapter.inspect({ sourceId: "not-a-source-id" }, signal()),
			);
		});
	});

type TrustFixture = Awaited<ReturnType<SkillTrustHarness>>;
const trustEntry = async (h: TrustFixture) => {
	const listed = SkillTrustListSchema.parse(
		value(await h.adapter.status(signal())),
	);
	expect(listed.complete).toBe(true);
	const entry = listed.entries.find(
		({ source }) => source.sourceId === h.sourceId,
	);
	if (!entry) throw new Error("Expected fixture trust entry");
	expect(entry.source).toEqual(h.snapshot.source);
	return entry;
};
const prepare = async (h: TrustFixture) => {
	const initial = await trustEntry(h);
	expect(initial).toMatchObject({
		status: "unapproved",
		revision: 0,
		currentSha256: h.snapshot.sha256,
	});
	expect(initial.approvedSha256).toBeUndefined();
	const preview = SkillPreviewSchema.parse(
		value(await h.adapter.prepare({ sourceId: h.sourceId }, signal())),
	);
	expect(preview.revision).toBe(initial.revision);
	expect(preview.inspection).toEqual(h.maskedInspection);
	expect(preview.inspection.source).toEqual(h.snapshot.source);
	expect(preview.inspection.sha256).toBe(h.snapshot.sha256);
	expect(await trustEntry(h)).toEqual(initial);
	return preview;
};
const admitted = (input: unknown) => {
	const mutation = SkillMutationResultSchema.parse(input);
	expect(mutation.admitted).toBe(true);
	return value(mutation.result);
};
const roundTrip = async (h: TrustFixture) => {
	const preview = await prepare(h);
	const input = { previewId: preview.previewId };
	const approved = admitted(await h.adapter.approve(input, signal()));
	expect(approved).toMatchObject({
		source: h.snapshot.source,
		status: "approved",
		approvedSha256: h.snapshot.sha256,
		currentSha256: h.snapshot.sha256,
	});
	expect(approved.revision).toBeGreaterThan(preview.revision);
	expect(await trustEntry(h)).toEqual(approved);
	const reused = SkillMutationResultSchema.parse(
		await h.adapter.approve(input, signal()),
	);
	expect(reused.result.ok).toBe(false);
	expect(await trustEntry(h)).toEqual(approved);
	const disabled = admitted(
		await h.adapter.disable(
			{ sourceId: h.sourceId, expectedRevision: approved.revision },
			signal(),
		),
	);
	expect(disabled).toMatchObject({
		source: h.snapshot.source,
		status: "disabled",
	});
	expect(disabled.revision).toBeGreaterThan(approved.revision);
	expect(disabled.approvedSha256).toBeUndefined();
	const refreshed = await trustEntry(h);
	expect(refreshed).toEqual({
		source: h.snapshot.source,
		status: "disabled",
		revision: disabled.revision,
		metadata: h.maskedInspection.metadata,
		currentSha256: h.snapshot.sha256,
		diagnostics: [],
	});
	const replay = SkillMutationResultSchema.parse(
		await h.adapter.approve(input, signal()),
	);
	expect(replay.result.ok).toBe(false);
	expect(await trustEntry(h)).toEqual(refreshed);
};
const invalidTrust = async (h: TrustFixture) => {
	const initial = await trustEntry(h);
	expect(initial).toMatchObject({ status: "unapproved", revision: 0 });
	expect(initial.approvedSha256).toBeUndefined();
	badInput(await h.adapter.prepare({ sourceId: "not-a-source-id" }, signal()));
	expect(await trustEntry(h)).toEqual(initial);
	const malformed = SkillMutationResultSchema.parse(
		await h.adapter.approve({ previewId: "not-a-preview-id" }, signal()),
	);
	expect(malformed.admitted).toBe(false);
	badInput(malformed.result);
	expect(await trustEntry(h)).toEqual(initial);
	const invalidDisable = SkillMutationResultSchema.parse(
		await h.adapter.disable(
			{ sourceId: h.sourceId, expectedRevision: -1 },
			signal(),
		),
	);
	expect(invalidDisable.admitted).toBe(false);
	badInput(invalidDisable.result);
	expect(await trustEntry(h)).toEqual(initial);
};

/** Every skill.trust@1 adapter must bind grants to reviewed versions and acknowledged revisions. */
export const skillTrustContract = (name: string, open: SkillTrustHarness) =>
	describe(`skill.trust@1 contract: ${name}`, () => {
		const setup = fixtures(open);
		it("previews without granting, approves, disables and refuses preview reuse", async () => {
			await roundTrip(await setup());
		});
		it("keeps malformed requests unadmitted without creating grants", async () => {
			await invalidTrust(await setup());
		});
	});
