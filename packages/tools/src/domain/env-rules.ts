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
	// bash runs PS4 before every statement when SHELLOPTS or BASHOPTS turn tracing on.
	"shellopts",
	"bashopts",
	"ps4",
]);
// bash_func_: exported bash functions shadow commands; cor_, coreclr_, complus_ and
// dotnet_ load profilers and startup hooks into PowerShell's .NET runtime.
const BLOCKED_PREFIXES = [
	"dyld_",
	"git_",
	"bash_func_",
	"cor_",
	"coreclr_",
	"complus_",
	"dotnet_",
];
// A name a shell can set itself; anything else (BASH_FUNC_x%%, A=B) is a trick.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The `env` keys shell.exec@1 refuses, compared without case. */
export const blockedEnvKeys = (env: Readonly<Record<string, string>>) =>
	Object.keys(env).filter((key) => {
		const k = key.toLowerCase();
		return (
			!NAME.test(key) ||
			BLOCKED.has(k) ||
			BLOCKED_PREFIXES.some((p) => k.startsWith(p))
		);
	});
