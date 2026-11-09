import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
	SkillReceiptSchema,
	SkillRuntimeInventorySchema,
	SkillRuntimeLoadInputSchema,
} from "../../src/domain/skill-runtime-receipts.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const runId = id(1);
const receipt = (
	n: number,
	contextId = id(100),
	sourceId = String(n).padStart(64, "0"),
) => ({
	receiptId: id(1000 + n),
	owner: { runId, contextId },
	operationId: id(2000 + n),
	version: { sourceId, sha256: "a".repeat(64), revision: 1 },
	origin: "explicit",
	loadedAt: "2026-11-08T00:00:00Z",
	payloadSha256: "b".repeat(64),
});
const first = receipt(1);
const second = receipt(2);
const load = {
	owner: first.owner,
	operationId: first.operationId,
	version: first.version,
	origin: first.origin,
};
const inventory = { runId, receipts: [first, second] };
const accepts = (schema: ZodType, input: unknown) =>
	expect(schema.parse(input)).toEqual(input);
const rejects = (schema: ZodType, input: unknown) =>
	expect(schema.safeParse(input).success).toBe(false);

describe("S2 receipt and complete inventory contracts", () => {
	it("retains distinct hashes and accepts explicit/model origins only", () => {
		for (const origin of ["explicit", "model"]) {
			accepts(SkillReceiptSchema, { ...first, origin });
			accepts(SkillRuntimeLoadInputSchema, { ...load, origin });
		}
		for (const bad of [
			{ ...load, origin: "manual" },
			{ ...load, origin: "auto" },
			{ ...load, operationId: "bad" },
			{ ...load, version: undefined },
			{ ...load, version: { ...load.version, sourceId: "bad" } },
			{ ...load, version: { ...load.version, sha256: "A".repeat(64) } },
			{ ...load, owner: { ...load.owner, contextId: "bad" } },
			{ ...load, owner: { ...load.owner, taskId: id(3) } },
		]) {
			rejects(SkillRuntimeLoadInputSchema, bad);
			rejects(SkillReceiptSchema, { ...first, ...bad });
		}
		for (const bad of [
			{ ...first, receiptId: "bad" },
			{ ...first, loadedAt: "yesterday" },
			{ ...first, payloadSha256: "a".repeat(63) },
			{ ...first, payloadSha256: "g".repeat(64) },
		])
			rejects(SkillReceiptSchema, bad);
		accepts(SkillRuntimeLoadInputSchema, { ...load, operationId: id(99) });
	});

	it("refuses bodies, roots, workspace bindings and caller trust declarations", () => {
		for (const extra of [
			{ text: "secret" },
			{ body: "instructions" },
			{ root: "/private" },
			{ workspacePath: "/private" },
			{ workspaceId: id(9) },
			{ trusted: true },
			{ complete: false },
		]) {
			rejects(SkillReceiptSchema, { ...first, ...extra });
			rejects(SkillRuntimeLoadInputSchema, { ...load, ...extra });
			rejects(SkillRuntimeInventorySchema, { ...inventory, ...extra });
		}
		rejects(SkillReceiptSchema, {
			...first,
			owner: { ...first.owner, trusted: true },
		});
		rejects(SkillRuntimeLoadInputSchema, {
			...load,
			version: { ...load.version, body: "instructions" },
		});
	});

	it("requires all receipts to belong to the declared run", () => {
		for (const bad of [
			{ ...inventory, runId: "bad" },
			{ runId },
			{ ...inventory, receipts: null },
			{ ...inventory, receipts: [{ ...first, operationId: "bad" }] },
			{
				...inventory,
				receipts: [{ ...first, owner: { ...first.owner, runId: id(2) } }],
			},
		])
			rejects(SkillRuntimeInventorySchema, bad);
		accepts(SkillRuntimeInventorySchema, {
			runId: id(2),
			receipts: [{ ...first, owner: { ...first.owner, runId: id(2) } }],
		});
	});

	it("refuses duplicate receipts, operations and context/source versions", () => {
		accepts(SkillRuntimeInventorySchema, inventory);
		const otherContext = receipt(2, id(101));
		for (const duplicate of [
			{ ...otherContext, receiptId: first.receiptId },
			{ ...otherContext, operationId: first.operationId },
			{ ...second, version: first.version },
			{ ...second, version: { ...first.version, revision: 2 } },
			{ ...second, version: { ...first.version, sha256: "c".repeat(64) } },
		])
			rejects(SkillRuntimeInventorySchema, {
				runId,
				receipts: [first, duplicate],
			});
		accepts(SkillRuntimeInventorySchema, {
			runId,
			receipts: [first, receipt(2, id(101), first.version.sourceId)],
		});
	});

	it("requires exactly one owner per context without relying on key order", () => {
		const owner = { ...first.owner, taskId: id(3), attemptId: id(4) };
		const taskReceipt = { ...first, owner };
		const reordered = Object.fromEntries(Object.entries(owner).reverse());
		accepts(SkillRuntimeInventorySchema, {
			runId,
			receipts: [taskReceipt, { ...second, owner: reordered }],
		});
		for (const changed of [
			{ ...owner, taskId: id(5) },
			{ ...owner, attemptId: id(6) },
			first.owner,
		])
			rejects(SkillRuntimeInventorySchema, {
				runId,
				receipts: [taskReceipt, { ...second, owner: changed }],
			});
	});

	it("allows four per context, refuses five and allows several full contexts", () => {
		const receipts = [1, 2, 3, 4, 5].map((n) => receipt(n));
		accepts(SkillRuntimeInventorySchema, {
			runId,
			receipts: receipts.slice(0, 4),
		});
		rejects(SkillRuntimeInventorySchema, { runId, receipts });
		const another = [5, 6, 7, 8].map((n) => receipt(n, id(101)));
		accepts(SkillRuntimeInventorySchema, {
			runId,
			receipts: [...receipts.slice(0, 4), ...another],
		});
		const interleaved = [1, 2, 3, 4].flatMap((n) => [
			receipt(n),
			receipt(n + 4, id(101)),
		]);
		accepts(SkillRuntimeInventorySchema, { runId, receipts: interleaved });
		rejects(SkillRuntimeInventorySchema, {
			runId,
			receipts: [...interleaved, receipt(9)],
		});
	});

	it("allows empty and complete inventories beyond the discovery entry cap", () => {
		accepts(SkillRuntimeInventorySchema, { runId, receipts: [] });
		const receipts = Array.from({ length: 129 }, (_, n) =>
			receipt(n + 1, id(100 + n)),
		);
		accepts(SkillRuntimeInventorySchema, { runId, receipts });
	});
});
