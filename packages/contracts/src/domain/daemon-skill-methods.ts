/** Existing S1 management and accepted S2 route names; implementations resolve independently. */
export const SKILL_DAEMON_METHODS = {
	skillsList: "mete/skills.list",
	skillsPrepare: "mete/skills.prepare",
	skillsApprove: "mete/skills.approve",
	skillsDisable: "mete/skills.disable",
	skillsEditor: "mete/skills.editor",
	skillsRuntime: "mete/skills.runtime",
	threadSkillsStart: "mete/thread.skills.start",
	threadSkillsReply: "mete/thread.skills.reply",
	runSkillsStart: "mete/run.skills.start",
	runSkillsRead: "mete/run.skills.read",
} as const;
