import type {
	DaemonSkillsListResult,
	DaemonSkillsPrepareResult,
	SkillError,
	SkillTrustEntry,
} from "@mete/contracts";

/** Safe failures are localized in the view, never rendered from raw exceptions. */
export type SkillIssue = SkillError | { readonly code: "transport" };
/** Retained evidence is usable only in ready, complete, nonbusy state. */
export type SkillState = {
	readonly phase: "idle" | "loading" | "ready" | "error" | "recovery";
	readonly busy: boolean;
	readonly inventory?:
		| Extract<DaemonSkillsListResult, { ok: true }>["value"]
		| undefined;
	readonly preview?:
		| Extract<DaemonSkillsPrepareResult, { ok: true }>["value"]
		| undefined;
	readonly error?: SkillIssue | undefined;
};
/** Callbacks retain the workspace/generation/session that rendered them. */
export type SkillsViewModel = {
	readonly state: SkillState;
	readonly onRefresh: () => Promise<void>;
	readonly onReview: (entry: SkillTrustEntry) => Promise<void>;
	readonly onApprove: () => Promise<void>;
	readonly onDisable: (entry: SkillTrustEntry) => Promise<void>;
	readonly onDismiss: () => void;
	readonly onRecover: () => Promise<void>;
	readonly onEdit?: (entry: SkillTrustEntry) => Promise<void>;
};

/** Invalid metadata can be repaired, but unsafe or missing native sources cannot be opened. */
export const canEditSkill = (entry: SkillTrustEntry): boolean => {
	if (["missing", "unavailable"].includes(entry.status)) return false;
	if (entry.status !== "invalid") return true;
	return (
		entry.diagnostics.length > 0 &&
		entry.diagnostics.every(
			({ location }) =>
				location !== undefined &&
				[
					"frontmatter",
					"name",
					"description",
					"license",
					"compatibility",
					"metadata",
					"allowed-tools",
					"body",
				].includes(location),
		)
	);
};
/** A disabled tombstone is not an enabled grant, even when it retains a hash. */
export const canDisableSkill = (entry: SkillTrustEntry): boolean =>
	entry.approvedSha256 !== undefined && entry.status !== "disabled";
