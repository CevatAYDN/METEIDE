// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Built-in policy: the example `.mete/policy.yaml` (12 Autonomy and security). */
export const DEFAULT_POLICY = {
	autonomy: 2,
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
