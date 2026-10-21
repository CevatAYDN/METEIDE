// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Built-in policy: the example `.mete/policy.yaml` (12 Autonomy and security). */
export const DEFAULT_POLICY = {
	autonomy: 2,
	overrides: { "shell.exec@1": 1 },
	always_ask: [
		"fs.delete",
		"git.push",
		"git.merge",
		"plugin.install",
		"mcp.install",
		"mcp.sampling",
		"release.publish",
		"vault.write.personal",
	],
	never_allow: [
		{ action: "fs.write", path: "~/.ssh/**" },
		{ action: "shell.exec", command: "rm -rf /*" },
	],
	shellAllow: ["pnpm *", "npm test", "npm run *", "git status", "git diff *"],
	cloudRequestsPerRun: 150,
	maxHours: 6,
	approvalTimeoutHours: 24,
} as const;

/** Team template values when a key is left out (08 Orchestration and teams, Team template schema). */
export const TEMPLATE_DEFAULTS = {
	engine: "native",
	revisionLimit: 3,
	guardrailMaxRetries: 2,
	reviewMaxTurns: 4,
	cloudRequests: 150,
	maxHours: 6,
	retrospective: false,
} as const;
