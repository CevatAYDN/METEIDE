// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** The keychain service every METE secret is stored under (09 Provider adapter, API keys). */
export const KEYCHAIN_SERVICE = "mete";

/** Tab 09, Privacy: a masked secret shows this many hex digits of its sha256. */
export const MASK_TAG_HEX = 8;

/**
 * SECURITY.md, Protected paths (ADR-072): an agent never writes, deletes or restores these, at any
 * autonomy level. Path globs under the workspace folder; `*` stays in one folder, so the agents' own
 * folders (`.mete/artifacts/`, `.mete/assets/`, `.mete/knowledge/`, `.mete/skills/`) stay writable.
 * The tools' checkpoint restore keeps the same set (packages/tools, vcs-checkpoint).
 */
export const PROTECTED_PATHS: readonly string[] = [
	".mete/*.yaml",
	".mete/teams/**",
	".mete/adapters/**", // ADR-120: a mapping decides what a capability runs
	".meteignore",
];

/**
 * SECURITY.md, Policy file (decision order, step 9): at level 2 a write to one of these asks, because
 * the files change which program an allow-listed command runs (a package script, a hook, a loaded
 * config). Patterns are path globs under the workspace folder; a task's worktree is judged as the
 * workspace it merges into (decide, asWorkspacePath).
 */
export const SCRIPT_MANIFESTS: readonly string[] = [
	"**/package.json",
	"**/.npmrc",
	"**/pnpm-workspace.yaml",
	"**/.pnpmfile.cjs",
	"**/lefthook.yml",
	"**/.husky/**",
	"**/.git/hooks/**",
	"**/.git/config",
];
