import { createHash } from "node:crypto";
import {
	checkSkillInventoryIntegrity,
	err,
	ok,
	type Result,
	type SkillRuntimeCheckInput,
	SkillRuntimeCheckInputSchema,
	type SkillRuntimeError,
	type SkillRuntimeInventory,
	type SkillSnapshot,
	type SkillVersion,
	skillSnapshotCanonical,
} from "@mete/contracts";
import {
	checkSkillGrants,
	lifetimeCurrent,
	requireCompleteSkillSources,
} from "./skill-runtime-evidence.js";
import {
	captureSkillRuntimeReaders,
	type SkillRuntimeReaderOptions,
	type SkillRuntimeReaders,
} from "./skill-runtime-readers.js";

/** Security-owned complete receipt membership for the current workspace. */
export type SkillReceiptInventory = {
	readonly inventory: (
		workspaceKey: string,
		runId: string,
	) => Result<SkillRuntimeInventory, SkillRuntimeError>;
};
/** Composition-owned check dependencies. */
export type SkillCheckOptions = SkillRuntimeReaderOptions & {
	readonly store: SkillReceiptInventory;
	readonly workspaceKey: string;
};

type Checked = Result<void, SkillRuntimeError>;

const payloadDigest = ({ payloadSha256: _, ...unsigned }: SkillSnapshot) =>
	createHash("sha256").update(skillSnapshotCanonical(unsigned)).digest("hex");

const versionsOf = (input: SkillRuntimeCheckInput): SkillVersion[] => [
	...new Map(
		input.snapshots.map(({ inspection, revision }) => [
			`${inspection.source.sourceId}:${inspection.sha256}:${revision}`,
			{
				sourceId: inspection.source.sourceId,
				sha256: inspection.sha256,
				revision,
			},
		]),
	).values(),
];

/** Starts from the independently read inventory, never the supplied snapshot list. */
const checkMembership = (
	opts: SkillCheckOptions,
	input: SkillRuntimeCheckInput,
): Checked => {
	try {
		const inventory = opts.store.inventory(opts.workspaceKey, input.runId);
		if (!inventory.ok) return inventory;
		return checkSkillInventoryIntegrity(inventory.value, input, payloadDigest);
	} catch {
		return err({ code: "storage_failed" });
	}
};

const checkEligible = async (
	readers: SkillRuntimeReaders,
	versions: readonly SkillVersion[],
	signal: AbortSignal,
): Promise<Checked> => {
	const sources = await requireCompleteSkillSources(readers, versions, signal);
	if (!sources.ok) return sources;
	const grants = await checkSkillGrants(readers, versions, signal);
	return grants.ok ? ok(undefined) : grants;
};

/** skill.runtime@1.check: integrity first, then current eligibility; no content is replaced. */
export const checkSkillSnapshots = async (
	opts: SkillCheckOptions,
	input: SkillRuntimeCheckInput,
	signal: AbortSignal,
): Promise<Checked> => {
	const parsed = SkillRuntimeCheckInputSchema.safeParse(input);
	if (!parsed.success) return err({ code: "bad_input" });
	if (signal.aborted) return err({ code: "aborted" });
	if (!lifetimeCurrent(opts.current)) return err({ code: "stale" });
	const membership = checkMembership(opts, parsed.data);
	if (!membership.ok) return membership;
	const versions = versionsOf(parsed.data);
	if (versions.length === 0) return ok(undefined);
	const readers = captureSkillRuntimeReaders(opts);
	if (!readers.ok) return readers;
	const eligible = await checkEligible(readers.value, versions, signal);
	if (signal.aborted) return err({ code: "aborted" });
	if (!lifetimeCurrent(opts.current) || !readers.value.current())
		return err({ code: "stale" });
	return eligible;
};
