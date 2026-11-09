import type { SkillTrustStatus } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { SkillIssue } from "./skill-session.js";

const statuses: Record<SkillTrustStatus, () => string> = {
	unapproved: () => nls.localize("mete/skills/unapproved", "Unapproved"),
	approved: () => nls.localize("mete/skills/approved", "Approved"),
	changed: () => nls.localize("mete/skills/changed", "Changed"),
	disabled: () => nls.localize("mete/skills/disabled", "Disabled"),
	missing: () => nls.localize("mete/skills/missing", "Missing"),
	invalid: () => nls.localize("mete/skills/invalid", "Invalid"),
	unavailable: () => nls.localize("mete/skills/unavailable", "Unavailable"),
};
const issues: Record<SkillIssue["code"], () => string> = {
	bad_input: () =>
		nls.localize("mete/skills/badInput", "Invalid source or request."),
	not_found: () =>
		nls.localize("mete/skills/notFound", "Source not found. Discover again."),
	ignored: () =>
		nls.localize("mete/skills/ignored", "Source excluded by workspace rules."),
	unavailable: () =>
		nls.localize(
			"mete/skills/readUnavailable",
			"Source or skill management unavailable. Refresh to retry.",
		),
	limit_exceeded: () =>
		nls.localize(
			"mete/skills/limitExceeded",
			"Discovery or source limit exceeded.",
		),
	stale: () =>
		nls.localize(
			"mete/skills/stale",
			"The source or session changed. Discover and review again.",
		),
	expired: () =>
		nls.localize("mete/skills/expired", "The preview expired. Review again."),
	aborted: () =>
		nls.localize(
			"mete/skills/aborted",
			"The operation was cancelled. Refresh before reviewing again.",
		),
	busy: () =>
		nls.localize(
			"mete/skills/busy",
			"Work is active. Wait until it ends or is paused, then review again.",
		),
	storage_failed: () =>
		nls.localize(
			"mete/skills/storageFailed",
			"The decision could not be saved. Refresh and review again.",
		),
	transport: () =>
		nls.localize(
			"mete/skills/transport",
			"Skill state could not be confirmed.",
		),
};

/** S1 management state, never loaded/used provenance. */
export const skillStatusText = (status: SkillTrustStatus): string =>
	statuses[status]();
/** Typed safe diagnostic text; no daemon exception text or unmasked source body. */
export const skillIssueText = (issue: SkillIssue): string =>
	issues[issue.code]();
/** Source scopes remain separate even for equal names. */
export const skillScopeText = (scope: "workspace" | "global"): string =>
	scope === "workspace"
		? nls.localize("mete/skills/workspace", "Workspace")
		: nls.localize("mete/skills/global", "Global");
