// shell.exec@1 `env` keys that change which program runs or what it loads (docs/10,
// Built-in tools): the policy sees only the command, so these would widen it.
const BLOCKED = new Set([
	"path",
	"pathext",
	"psmodulepath",
	"comspec",
	"node_options",
	"node_path",
	"ld_preload",
	"ld_library_path",
	"pythonpath",
	"pythonstartup",
	"perl5opt",
	"rubyopt",
	"bash_env",
	"env",
]);
const BLOCKED_PREFIXES = ["dyld_", "git_"];

/** The `env` keys shell.exec@1 refuses, compared without case. */
export const blockedEnvKeys = (env: Readonly<Record<string, string>>) =>
	Object.keys(env).filter((key) => {
		const k = key.toLowerCase();
		return BLOCKED.has(k) || BLOCKED_PREFIXES.some((p) => k.startsWith(p));
	});
