import { err, ok, type Result } from "./result.js";
import type { SkillOwner, SkillSnapshot } from "./skill-runtime.js";
import type { SkillRuntimeError } from "./skill-runtime-catalog.js";
import { SkillRuntimeCheckInputSchema } from "./skill-runtime-port.js";
import {
	type SkillReceipt,
	SkillRuntimeInventorySchema,
} from "./skill-runtime-receipts.js";

const failed = () => err<SkillRuntimeError>({ code: "integrity_failed" });
const sameOwner = (a: SkillOwner, b: SkillOwner) =>
	a.runId === b.runId &&
	a.contextId === b.contextId &&
	a.taskId === b.taskId &&
	a.attemptId === b.attemptId;
const matches = (
	receipt: SkillReceipt,
	snapshot: SkillSnapshot,
	digest: string,
) =>
	receipt.receiptId === snapshot.receiptId &&
	sameOwner(receipt.owner, snapshot.owner) &&
	receipt.version.sourceId === snapshot.inspection.source.sourceId &&
	receipt.version.sha256 === snapshot.inspection.sha256 &&
	receipt.version.revision === snapshot.revision &&
	receipt.origin === snapshot.origin &&
	receipt.loadedAt === snapshot.loadedAt &&
	receipt.payloadSha256 === snapshot.payloadSha256 &&
	receipt.payloadSha256 === digest;

/**
 * Pure complete-membership comparison for native runtime and history readers.
 * The caller must authenticate inventory through security and compute the canonical SHA-256;
 * a caller-supplied inventory or digest callback never grants execution authority.
 */
export const checkSkillInventoryIntegrity = (
	inventory: unknown,
	input: unknown,
	digest: (snapshot: SkillSnapshot) => string,
): Result<void, SkillRuntimeError> => {
	const issued = SkillRuntimeInventorySchema.safeParse(inventory);
	const retained = SkillRuntimeCheckInputSchema.safeParse(input);
	if (!issued.success || !retained.success) return failed();
	if (
		issued.data.runId !== retained.data.runId ||
		issued.data.receipts.length !== retained.data.snapshots.length
	)
		return failed();
	const snapshots = new Map(
		retained.data.snapshots.map((s) => [s.receiptId, s]),
	);
	try {
		for (const receipt of issued.data.receipts) {
			const snapshot = snapshots.get(receipt.receiptId);
			if (!snapshot || !matches(receipt, snapshot, digest(snapshot)))
				return failed();
		}
		return ok(undefined);
	} catch {
		return failed();
	}
};
