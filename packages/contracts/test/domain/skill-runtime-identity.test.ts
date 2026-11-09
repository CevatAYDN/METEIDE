import { describe, expect, it } from "vitest";
import type { SkillSnapshot } from "../../src/domain/skill-runtime.js";
import { skillSnapshotCanonical } from "../../src/domain/skill-runtime-identity.js";
import {
	SkillMetadataSchema,
	SkillRuntimeCheckInputSchema,
	SkillRuntimeLoadResultSchema,
	SkillSnapshotSchema,
} from "../../src/index.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snapshot = {
	receiptId: id(1),
	owner: { runId: id(2), contextId: id(3), taskId: id(4), attemptId: id(5) },
	inspection: {
		source: {
			sourceId: "a".repeat(64),
			scope: "workspace",
			path: "review/SKILL.md",
		},
		text: "\ufeff---\r\nname: review\r\n---\r\nExact body",
		sha256: "b".repeat(64),
		metadata: {
			name: "review",
			description: "Review code",
			license: "MIT",
			compatibility: "Local",
			metadata: Object.fromEntries([
				["\u00e4", "unicode"],
				["2", "two"],
				["10", "ten"],
				["Z", "upper"],
				["a", "lower"],
				["__proto__", "ordinary key"],
			]),
			"allowed-tools": "fs.read",
		},
	},
	revision: 1,
	origin: "explicit",
	loadedAt: "2026-11-08T00:00:00Z",
} satisfies Omit<SkillSnapshot, "payloadSha256">;
const inspection = snapshot.inspection;
const withInspection = (value: SkillSnapshot["inspection"]) => ({
	...snapshot,
	inspection: value,
});
const differs = (value: Omit<SkillSnapshot, "payloadSha256">) =>
	expect(skillSnapshotCanonical(value)).not.toBe(
		skillSnapshotCanonical(snapshot),
	);

describe("skill snapshot canonical payload", () => {
	it("preserves prototype-looking map keys through every snapshot parsing boundary", () => {
		const pairs = Object.freeze({
			...inspection.metadata.metadata,
			constructor: "ordinary constructor",
		});
		const full = Object.freeze({
			...withInspection(
				Object.freeze({
					...inspection,
					metadata: Object.freeze({ ...inspection.metadata, metadata: pairs }),
				}),
			),
			payloadSha256: "c".repeat(64),
		});
		const before = JSON.stringify(full);
		const canonical = skillSnapshotCanonical(full);
		const parsedMetadata = SkillMetadataSchema.parse(full.inspection.metadata);
		const parsedSnapshots = [
			{ ...full, inspection: { ...full.inspection, metadata: parsedMetadata } },
			SkillSnapshotSchema.parse(full),
			...SkillRuntimeCheckInputSchema.parse({
				runId: full.owner.runId,
				snapshots: [full],
			}).snapshots,
		];
		const loaded = SkillRuntimeLoadResultSchema.parse({
			ok: true,
			value: full,
		});
		if (!loaded.ok) expect.fail("Expected a successful snapshot load result");
		else parsedSnapshots.push(loaded.value);
		for (const parsed of parsedSnapshots) {
			expect(parsed.inspection.metadata.metadata).toEqual(pairs);
			expect(
				Object.hasOwn(parsed.inspection.metadata.metadata ?? {}, "__proto__"),
			).toBe(true);
			expect(skillSnapshotCanonical(parsed)).toBe(canonical);
		}
		const changed = {
			...full,
			inspection: {
				...full.inspection,
				metadata: {
					...full.inspection.metadata,
					metadata: { ...pairs, ["__proto__"]: "changed value" },
				},
			},
		};
		expect(skillSnapshotCanonical(SkillSnapshotSchema.parse(changed))).not.toBe(
			canonical,
		);
		expect(JSON.stringify(full)).toBe(before);
	});

	it("fixes every object order and sorts map keys by code units, not locale or number", () => {
		const reordered = {
			loadedAt: snapshot.loadedAt,
			origin: snapshot.origin,
			revision: snapshot.revision,
			inspection: {
				metadata: {
					"allowed-tools": inspection.metadata["allowed-tools"],
					metadata: Object.fromEntries(
						Object.entries(inspection.metadata.metadata).reverse(),
					),
					compatibility: inspection.metadata.compatibility,
					license: inspection.metadata.license,
					description: inspection.metadata.description,
					name: inspection.metadata.name,
				},
				sha256: inspection.sha256,
				text: inspection.text,
				source: {
					path: inspection.source.path,
					scope: inspection.source.scope,
					sourceId: inspection.source.sourceId,
				},
			},
			owner: {
				attemptId: snapshot.owner.attemptId,
				taskId: snapshot.owner.taskId,
				contextId: snapshot.owner.contextId,
				runId: snapshot.owner.runId,
			},
			receiptId: snapshot.receiptId,
		};
		const canonical = skillSnapshotCanonical(snapshot);
		expect(skillSnapshotCanonical(reordered)).toBe(canonical);
		expect(canonical).toContain(
			'"metadata":{"10":"ten","2":"two","Z":"upper","__proto__":"ordinary key","a":"lower","\u00e4":"unicode"}',
		);
		const decoded: unknown = JSON.parse(canonical);
		expect(decoded).toEqual(snapshot);
	});

	it("binds receipt, revision, origin, timestamp and every owner field", () => {
		for (const changed of [
			{ ...snapshot, receiptId: id(99) },
			{ ...snapshot, revision: 2 },
			{ ...snapshot, origin: "model" as const },
			{ ...snapshot, loadedAt: "2026-11-08T00:00:00.000Z" },
		])
			differs(changed);
		for (const field of ["runId", "contextId", "taskId", "attemptId"] as const)
			differs({
				...snapshot,
				owner: { ...snapshot.owner, [field]: id(99) },
			});
		const { taskId: _task, attemptId: _attempt, ...owner } = snapshot.owner;
		differs({ ...snapshot, owner });
	});

	it("binds every inspection/source field and optional standard metadata field", () => {
		for (const changed of [
			{ ...inspection, text: `${inspection.text}\n` },
			{ ...inspection, sha256: "d".repeat(64) },
			{
				...inspection,
				source: { ...inspection.source, sourceId: "e".repeat(64) },
			},
			{
				...inspection,
				source: { ...inspection.source, scope: "global" as const },
			},
			{
				...inspection,
				source: { ...inspection.source, path: "other/SKILL.md" },
			},
		])
			differs(withInspection(changed));
		for (const field of [
			"name",
			"description",
			"license",
			"compatibility",
			"allowed-tools",
		] as const)
			differs(
				withInspection({
					...inspection,
					metadata: {
						...inspection.metadata,
						[field]: `${inspection.metadata[field]} changed`,
					},
				}),
			);
		const pairs = inspection.metadata.metadata;
		for (const [key, value] of Object.entries(pairs)) {
			const { [key]: _removed, ...rest } = pairs;
			for (const metadata of [
				{ ...pairs, [key]: `${value} changed` },
				{ ...rest, [`${key} changed`]: value },
			])
				differs(
					withInspection({
						...inspection,
						metadata: { ...inspection.metadata, metadata },
					}),
				);
		}
	});

	it("roundtrips exact special text, Unicode, BOM, CRLF and timestamp spelling", () => {
		const text = '\ufeff"\\\t\r\n\u00e9 e\u0301 \ud83d\udcdd \u2028\u2029\r\n ';
		const exact = withInspection({
			...inspection,
			text,
			source: { ...inspection.source, path: "\u00e9/SKILL.md" },
			metadata: {
				...inspection.metadata,
				description: text,
				license: text,
				compatibility: text,
				"allowed-tools": text,
				metadata: { [text]: text },
			},
		});
		const decoded: unknown = JSON.parse(skillSnapshotCanonical(exact));
		expect(decoded).toEqual(exact);
	});

	it("excludes only the self-digest even for a full compatible snapshot", () => {
		const full: SkillSnapshot = { ...snapshot, payloadSha256: "c".repeat(64) };
		const changed: SkillSnapshot = { ...full, payloadSha256: "d".repeat(64) };
		expect(skillSnapshotCanonical(full)).toBe(skillSnapshotCanonical(snapshot));
		expect(skillSnapshotCanonical(changed)).toBe(
			skillSnapshotCanonical(snapshot),
		);
	});

	it("preserves empty versus absent optional metadata", () => {
		const minimal = withInspection({
			...inspection,
			metadata: { name: "review", description: "Review code" },
		});
		const canonical = skillSnapshotCanonical(minimal);
		for (const field of [
			"license",
			"compatibility",
			"allowed-tools",
		] as const) {
			const empty = {
				...minimal,
				inspection: {
					...minimal.inspection,
					metadata: { ...minimal.inspection.metadata, [field]: "" },
				},
			};
			expect(skillSnapshotCanonical(empty)).not.toBe(canonical);
			const decoded: unknown = JSON.parse(skillSnapshotCanonical(empty));
			expect(decoded).toEqual(empty);
		}
		const emptyMap = withInspection({
			...minimal.inspection,
			metadata: { ...minimal.inspection.metadata, metadata: {} },
		});
		expect(skillSnapshotCanonical(emptyMap)).not.toBe(canonical);
		const decoded: unknown = JSON.parse(skillSnapshotCanonical(emptyMap));
		expect(decoded).toEqual(emptyMap);
	});

	it("does not mutate a deeply frozen input", () => {
		const frozen = Object.freeze({
			...snapshot,
			owner: Object.freeze({ ...snapshot.owner }),
			inspection: Object.freeze({
				...inspection,
				source: Object.freeze({ ...inspection.source }),
				metadata: Object.freeze({
					...inspection.metadata,
					metadata: Object.freeze({ ...inspection.metadata.metadata }),
				}),
			}),
		});
		const before = JSON.stringify(frozen);
		expect(skillSnapshotCanonical(frozen)).toBe(
			skillSnapshotCanonical(snapshot),
		);
		expect(JSON.stringify(frozen)).toBe(before);
	});
});
