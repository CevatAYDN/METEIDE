import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
	SkillContextSummarySchema as contextSchema,
	SkillLoadedMetadataSchema as loadedSchema,
	SkillCatalogNoticeSchema as noticeSchema,
} from "../../src/domain/skill-usage.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const metadata = (n: number) => {
	const sourceId = n.toString(16).padStart(64, "0");
	return {
		receiptId: id(n),
		version: { sourceId, sha256: "b".repeat(64), revision: 7 },
		source: { sourceId, scope: "workspace", path: "review/SKILL.md" },
		name: "review",
		origin: "model",
		loadedAt: "2026-11-09T08:30:00.123Z",
		payloadSha256: "c".repeat(64),
	};
};
const entry = metadata(1);
const owner = { runId: id(10), contextId: id(11) };
const context = {
	owner,
	roleId: "assistant",
	policy: { mode: "auto", selected: [] },
	status: "loaded",
	loaded: [entry],
};
const block = { code: "revoked", sourceId: entry.version.sourceId };
const ready = { status: "ready", diagnostics: [] };
const unavailable = { status: "unavailable", diagnostics: [block] };
const accepts = (schema: ZodType, input: unknown) =>
	expect(schema.parse(input)).toEqual(input);
const rejects = (schema: ZodType, input: unknown) =>
	expect(schema.safeParse(input).success).toBe(false);

describe("S2 metadata-only context evidence", () => {
	it("retains exact identities, separate hashes, revision, UTC time and origins", () => {
		for (const origin of ["explicit", "model"])
			accepts(loadedSchema, { ...entry, origin });
		for (const key of Object.keys(entry))
			rejects(loadedSchema, { ...entry, [key]: undefined });
		for (const patch of [
			{ receiptId: "bad" },
			{ payloadSha256: "bad" },
			{ loadedAt: "2026-02-30T08:30:00Z" },
			{ loadedAt: "2026-11-09" },
			{ origin: "provider" },
			{ name: "Upper" },
			{ version: { ...entry.version, sourceId: "d".repeat(64) } },
			{ version: { ...entry.version, sha256: "B".repeat(64) } },
			{ version: { ...entry.version, revision: 0 } },
			{ version: { ...entry.version, revision: 1.5 } },
			{ version: { ...entry.version, revision: Number.MAX_SAFE_INTEGER + 1 } },
			{ source: { ...entry.source, path: "/private/SKILL.md" } },
		])
			rejects(loadedSchema, { ...entry, ...patch });
	});

	it.each([
		"description",
		"text",
		"body",
		"inspection",
		"root",
		"sessionId",
		"trusted",
		"authority",
		"providerUsed",
		"followed",
		"compliant",
	])("refuses the extra %s field at every read boundary", (field) => {
		const extra = { [field]: "untrusted" };
		rejects(loadedSchema, { ...entry, ...extra });
		rejects(contextSchema, { ...context, ...extra });
		for (const notice of [ready, unavailable])
			rejects(noticeSchema, { ...notice, ...extra });
	});

	it("retains owner pairing and refuses malformed or extended nested evidence", () => {
		accepts(contextSchema, context);
		const paired = { ...owner, taskId: id(12), attemptId: id(13) };
		accepts(contextSchema, { ...context, owner: paired });
		for (const patch of [
			{ owner: { ...owner, taskId: id(12) } },
			{ owner: { ...owner, attemptId: id(13) } },
			{ owner: { ...paired, taskId: "bad" } },
			{ owner: { ...paired, attemptId: "bad" } },
			{ owner: { ...owner, runId: "bad" } },
			{ owner: { ...owner, contextId: "bad" } },
			{ owner: { ...owner, trusted: true } },
			{ policy: { ...context.policy, trusted: true } },
			{ roleId: "Bad-Role" },
			{ status: "used" },
			{ loaded: undefined },
		])
			rejects(contextSchema, { ...context, ...patch });
		for (const field of ["source", "version"] as const)
			rejects(loadedSchema, {
				...entry,
				[field]: { ...entry[field], trusted: true },
			});
	});

	it("distinguishes ready-empty from unavailable without entries or raw diagnostics", () => {
		for (const catalog of [ready, unavailable]) {
			accepts(noticeSchema, catalog);
			accepts(contextSchema, { ...context, catalog });
			rejects(noticeSchema, { ...catalog, entries: [] });
		}
		for (const bad of [
			{ ...ready, diagnostics: [block] },
			{ ...unavailable, diagnostics: [] },
			{ status: "ready" },
			{ ...ready, status: "partial" },
		])
			rejects(noticeSchema, bad);
		for (const extra of [
			{ message: "secret" },
			{ body: "secret" },
			{ path: "/private" },
		]) {
			const bad = { ...block, ...extra };
			rejects(noticeSchema, { ...unavailable, diagnostics: [bad] });
			rejects(contextSchema, { ...context, status: "blocked", block: bad });
		}
	});

	it.each([
		["selected", [], undefined, true],
		["selected", [entry], undefined, false],
		["selected", [], block, false],
		["selected", [entry], block, false],
		["loaded", [], undefined, false],
		["loaded", [entry], undefined, true],
		["loaded", [], block, false],
		["loaded", [entry], block, false],
		["blocked", [], undefined, false],
		["blocked", [entry], undefined, false],
		["blocked", [], block, true],
		["blocked", [entry], block, true],
		["history", [], undefined, true],
		["history", [entry], undefined, true],
		["history", [], block, true],
		["history", [entry], block, true],
	])("enforces %s evidence state (case %#)", (status, loaded, block, valid) => {
		const result = contextSchema.safeParse({
			...context,
			status,
			loaded,
			block,
		});
		expect(result.success).toBe(valid);
	});

	it("allows four distinct same-name sources but refuses five or duplicate identities", () => {
		const records = Array.from({ length: 5 }, (_, i) => metadata(i + 1));
		accepts(contextSchema, { ...context, loaded: records.slice(0, 4) });
		const global = { ...entry, source: { ...entry.source, scope: "global" } };
		accepts(contextSchema, { ...context, loaded: [global, metadata(2)] });
		for (const loaded of [
			records,
			[entry, entry],
			[entry, { ...entry, receiptId: id(2) }],
			[entry, { ...metadata(2), receiptId: entry.receiptId }],
		])
			rejects(contextSchema, { ...context, loaded });
	});

	it.each(["loaded", "blocked", "history"])(
		"binds %s origins to the original policy and exact selected version",
		(status) => {
			const retained = {
				...context,
				status,
				...(status === "blocked" ? { block } : {}),
			};
			const loaded = [{ ...entry, origin: "explicit" }];
			for (const mode of ["manual", "auto"]) {
				const policy = { mode, selected: [entry.version] };
				accepts(contextSchema, { ...retained, loaded, policy });
				for (const selected of [
					[],
					[{ ...entry.version, sourceId: "d".repeat(64) }],
					[{ ...entry.version, sha256: "d".repeat(64) }],
					[{ ...entry.version, revision: 8 }],
				])
					rejects(contextSchema, {
						...retained,
						loaded,
						policy: { mode, selected },
					});
				const modelClaim = { ...retained, policy };
				// Explicit selections must finish before any model-origin load.
				rejects(contextSchema, modelClaim);
			}
			rejects(contextSchema, {
				...retained,
				policy: { mode: "off", selected: [] },
			});
		},
	);

	it("requires an ordered explicit prefix before model additions", () => {
		const a = { ...metadata(1), origin: "explicit" };
		const b = { ...metadata(2), origin: "explicit" };
		const c = metadata(3);
		const policy = { mode: "auto", selected: [a.version, b.version] };
		const partial = {
			...context,
			policy,
			status: "blocked",
			block,
			loaded: [a],
		};
		accepts(contextSchema, partial);
		accepts(contextSchema, { ...context, policy, loaded: [a, b, c] });
		for (const loaded of [[b], [b, a], [a, c], [c, a, b]])
			rejects(contextSchema, { ...context, policy, loaded });
	});

	it("refuses a fifth selected-or-loaded source hidden behind an unfinished explicit set", () => {
		const selected = [1, 2, 3, 4].map((n) => metadata(n).version);
		rejects(contextSchema, {
			...context,
			policy: { mode: "auto", selected },
			loaded: [metadata(5)],
		});
	});

	it("allows empty off contexts but never selections under off", () => {
		for (const status of ["selected", "blocked", "history"]) {
			const empty = {
				...context,
				status,
				loaded: [],
				...(status === "blocked" ? { block } : {}),
			};
			const policy = { mode: "off", selected: [] };
			accepts(contextSchema, { ...empty, policy });
			rejects(contextSchema, {
				...empty,
				policy: { ...policy, selected: [entry.version] },
			});
		}
	});
});
