import type {
	DaemonSkillsListResult,
	DaemonSkillsPrepareResult,
	SkillTrustEntry,
} from "@mete/contracts";

export const SKILL_SESSION = "11111111-1111-4111-8111-111111111111";
export const SKILL_PREVIEW = "22222222-2222-4222-8222-222222222222";
export const SKILL_SOURCE = "a".repeat(64);
export const skillEntry: SkillTrustEntry = {
	source: {
		sourceId: SKILL_SOURCE,
		scope: "workspace",
		path: "review-fixture/SKILL.md",
	},
	metadata: { name: "review-fixture", description: "Review fixture" },
	status: "unapproved",
	revision: 0,
	currentSha256: "b".repeat(64),
	diagnostics: [],
};
export const skillList: DaemonSkillsListResult = {
	ok: true,
	value: {
		sessionId: SKILL_SESSION,
		entries: [skillEntry],
		complete: true,
		diagnostics: [],
	},
};
export const skillPreview: DaemonSkillsPrepareResult = {
	ok: true,
	value: {
		sessionId: SKILL_SESSION,
		previewId: SKILL_PREVIEW,
		revision: 0,
		expiresAt: "2026-11-08T12:05:00.000Z",
		inspection: {
			source: skillEntry.source,
			metadata: skillEntry.metadata ?? {
				name: "review-fixture",
				description: "Review fixture",
			},
			sha256: "b".repeat(64),
			text: "---\nname: review-fixture\ndescription: Review fixture\n---\n<script>masked plaintext</script>\nEND OF FULL PREVIEW",
		},
	},
};
export const approvedSkill: SkillTrustEntry = {
	...skillEntry,
	status: "approved",
	revision: 1,
	approvedSha256: "b".repeat(64),
};
