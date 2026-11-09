import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { SKILL_RUNTIME_LIMITS } from "../../src/defaults.js";
import {
	SkillContextSnapshotsSchema,
	SkillOwnerSchema,
	SkillPolicySchema,
	SkillSnapshotSchema,
	SkillVersionSchema,
} from "../../src/domain/skill-runtime.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = { runId: id(1), contextId: id(2) };
const taskOwner = { ...owner, taskId: id(3), attemptId: id(4) };
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};
const inspection = {
	source: {
		sourceId: version.sourceId,
		scope: "workspace",
		path: "review/SKILL.md",
	},
	sha256: version.sha256,
	text: "\ufeff---\r\nname: review\r\n---\r\nComplete masked body",
	metadata: {
		name: "review",
		description: "Review code",
		license: "MIT",
		compatibility: "Informational",
		metadata: { owner: "local" },
		"allowed-tools": "fs.read",
	},
};
const snapshot = {
	receiptId: id(10),
	owner,
	inspection,
	revision: 1,
	origin: "explicit",
	loadedAt: "2026-11-08T00:00:00Z",
	payloadSha256: "c".repeat(64),
};
const distinct = (n: number, text = "Body", scope = "workspace") => ({
	...snapshot,
	receiptId: id(10 + n),
	inspection: {
		...inspection,
		text,
		source: {
			...inspection.source,
			scope,
			sourceId: n.toString(16).padStart(64, "0"),
		},
	},
});
const withText = (text: string) => ({
	...snapshot,
	inspection: { ...inspection, text },
});
const accepts = (schema: ZodType, input: unknown) =>
	expect(schema.parse(input)).toEqual(input);
const rejects = (schema: ZodType, input: unknown) =>
	expect(schema.safeParse(input).success).toBe(false);

describe("S2 primitive runtime contracts", () => {
	it("requires exact versions, valid digests and positive safe revisions", () => {
		accepts(SkillVersionSchema, version);
		for (const digest of ["", "a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
			for (const field of ["sourceId", "sha256"])
				rejects(SkillVersionSchema, { ...version, [field]: digest });
		}
		rejects(SkillVersionSchema, { ...version, trusted: true });
		const unsafe = Number.MAX_SAFE_INTEGER + 1;
		for (const revision of [0, -1, 1.5, unsafe, NaN, Infinity]) {
			rejects(SkillVersionSchema, { ...version, revision });
			rejects(SkillSnapshotSchema, { ...snapshot, revision });
		}
		const revision = Number.MAX_SAFE_INTEGER;
		accepts(SkillVersionSchema, { ...version, revision });
		accepts(SkillSnapshotSchema, { ...snapshot, revision });
	});

	it("requires paired task and attempt IDs without inventing them", () => {
		accepts(SkillOwnerSchema, owner);
		accepts(SkillOwnerSchema, taskOwner);
		for (const bad of [
			{ ...owner, taskId: id(3) },
			{ ...owner, attemptId: id(4) },
			{ ...taskOwner, attemptId: undefined },
			{ ...owner, agentId: id(5) },
		])
			rejects(SkillOwnerSchema, bad);
		for (const field of ["runId", "contextId", "taskId", "attemptId"])
			rejects(SkillOwnerSchema, { ...taskOwner, [field]: "not-an-id" });
	});

	it("uses accepted defaults and refuses invalid, off or duplicate selections", () => {
		expect(SKILL_RUNTIME_LIMITS).toEqual({
			catalogBytes: 16384,
			perContext: 4,
			totalBytes: 65536,
		});
		expect(SkillPolicySchema.parse({})).toEqual({ mode: "auto", selected: [] });
		for (const mode of ["manual", "auto"])
			accepts(SkillPolicySchema, { mode, selected: [version] });
		expect(SkillPolicySchema.parse({ mode: "off" })).toEqual({
			mode: "off",
			selected: [],
		});
		for (const bad of [
			{ mode: "off", selected: [version] },
			{ mode: "always" },
			{ selected: [{ ...version, revision: 0 }] },
			{ enabled: true },
		])
			rejects(SkillPolicySchema, bad);
		const other = { ...version, sourceId: "d".repeat(64) };
		accepts(SkillPolicySchema, { mode: "auto", selected: [other, version] });
		for (const duplicate of [
			version,
			{ ...version, sha256: "d".repeat(64) },
			{ ...version, revision: 2 },
		])
			rejects(SkillPolicySchema, { selected: [version, duplicate] });
		const selected = [1, 2, 3, 4, 5].map((n) => ({
			...version,
			sourceId: n.toString(16).padStart(64, "0"),
		}));
		accepts(SkillPolicySchema, {
			mode: "auto",
			selected: selected.slice(0, 4),
		});
		rejects(SkillPolicySchema, { selected });
	});

	it("retains exact masked inspection and refuses invalid nested records", () => {
		accepts(SkillSnapshotSchema, snapshot);
		accepts(SkillSnapshotSchema, {
			...snapshot,
			owner: taskOwner,
			origin: "model",
		});
		for (const bad of [
			{ ...snapshot, approved: true },
			{ ...snapshot, receiptId: "bad" },
			{ ...snapshot, owner: { ...owner, contextId: "bad" } },
			{ ...snapshot, origin: "manual" },
			{ ...snapshot, loadedAt: "yesterday" },
			{ ...snapshot, payloadSha256: "A".repeat(64) },
			{ ...snapshot, payloadSha256: "g".repeat(64) },
			{ ...snapshot, payloadSha256: "a".repeat(63) },
		])
			rejects(SkillSnapshotSchema, bad);
		for (const invalid of [
			{ ...inspection, sha256: "bad" },
			{ ...inspection, metadata: undefined },
			{ ...inspection, source: undefined },
			{ ...inspection, text: undefined },
			{ ...inspection, approved: true },
			{ ...inspection, source: { ...inspection.source, root: "/tmp" } },
			{ ...inspection, source: { ...inspection.source, sourceId: "bad" } },
			{ ...inspection, source: { ...inspection.source, path: "../SKILL.md" } },
			{ ...inspection, metadata: { ...inspection.metadata, hooks: true } },
			{
				...inspection,
				metadata: { ...inspection.metadata, description: " \n" },
			},
			{
				...inspection,
				metadata: { ...inspection.metadata, license: "\ud800" },
			},
		])
			rejects(SkillSnapshotSchema, { ...snapshot, inspection: invalid });
	});

	it("inherits per-snapshot UTF-8 limits without repairing or truncating text", () => {
		const valid = [
			"a".repeat(65536),
			"\u00e9".repeat(32768),
			"\ud83d\udcdd".repeat(16384),
		];
		for (const text of valid) accepts(SkillSnapshotSchema, withText(text));
		const invalid = [
			"a".repeat(65537),
			"\u00e9".repeat(32769),
			"\ud800",
			"\udc00",
			"a\0b",
		];
		for (const text of invalid) rejects(SkillSnapshotSchema, withText(text));
	});

	it("bounds snapshots and requires exact context owners independent of key order", () => {
		accepts(SkillContextSnapshotsSchema, []);
		const snapshots = [1, 2, 3, 4, 5].map((n) => distinct(n));
		accepts(SkillContextSnapshotsSchema, snapshots.slice(0, 4));
		rejects(SkillContextSnapshotsSchema, snapshots);
		rejects(SkillContextSnapshotsSchema, [{ ...snapshot, extra: true }]);
		const first = { ...distinct(1), owner: taskOwner };
		const second = {
			...distinct(2),
			owner: Object.fromEntries(Object.entries(taskOwner).reverse()),
		};
		accepts(SkillContextSnapshotsSchema, [first, second]);
		for (const field of ["runId", "contextId", "taskId", "attemptId"])
			rejects(SkillContextSnapshotsSchema, [
				first,
				{ ...second, owner: { ...taskOwner, [field]: id(99) } },
			]);
		rejects(SkillContextSnapshotsSchema, [first, { ...second, owner }]);
		// Separate contexts can each validate; this schema is not a run-wide limit.
		accepts(SkillContextSnapshotsSchema, [
			{ ...second, owner: { ...taskOwner, contextId: id(99) } },
		]);
	});

	it("refuses duplicate receipts or sources even with different versions", () => {
		const first = distinct(1);
		const second = distinct(2);
		accepts(SkillContextSnapshotsSchema, [
			first,
			distinct(2, "Body", "global"),
		]);
		for (const duplicate of [
			{ ...second, receiptId: first.receiptId },
			{ ...second, inspection: first.inspection },
			{
				...second,
				revision: 2,
				inspection: { ...first.inspection, sha256: "d".repeat(64) },
			},
		])
			rejects(SkillContextSnapshotsSchema, [first, duplicate]);
	});

	it("counts combined complete text in UTF-8 bytes at the exact boundary", () => {
		const exact = [
			distinct(1, "\u00e9".repeat(16384)),
			distinct(2, "\ud83d\udcdd".repeat(8192)),
		];
		accepts(SkillContextSnapshotsSchema, exact);
		rejects(SkillContextSnapshotsSchema, [
			exact[0],
			distinct(2, `${"\ud83d\udcdd".repeat(8192)}a`),
		]);
		accepts(
			SkillContextSnapshotsSchema,
			[1, 2, 3, 4].map((n) => distinct(n, "a".repeat(16384))),
		);
		rejects(SkillContextSnapshotsSchema, [
			distinct(1, "a".repeat(65536)),
			distinct(2, "a"),
		]);
	});
});
