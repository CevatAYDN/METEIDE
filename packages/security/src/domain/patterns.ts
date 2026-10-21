import { posix, win32 } from "node:path";

// Pattern matching from SECURITY.md (Policy file). node:path matchesGlob is not used:
// it skips dot files and compares Windows paths with case (docs/05, Glob).

/** What a path needs to become comparable: the OS rules, `~` and the workspace root. */
export type PathEnv = {
	readonly platform: NodeJS.Platform;
	readonly home: string;
	readonly workspaceDir: string;
};

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const escapeRegex = (s: string) => s.replace(REGEX_SPECIAL, "\\$&");
const collapse = (s: string) => s.trim().replace(/\s+/g, " ");

/** Whole-command match after trimming and collapsing spaces; `*` matches any text. */
export const commandMatches = (pattern: string, command: string): boolean => {
	const body = collapse(pattern).split("*").map(escapeRegex).join(".*");
	return new RegExp(`^${body}$`, "s").test(collapse(command));
};

// Commands run in a shell (docs/10), so these characters can chain, redirect or run more.
const SHELL_OPERATOR = /[&|;\r\n`()<>]/;
const PART_BREAK = /&&|\|\||[;&|\r\n`()]/;

/** True when the command could do more than one thing; quotes are not parsed, so it fails closed. */
export const hasShellOperator = (command: string): boolean =>
	SHELL_OPERATOR.test(command);

/** The parts a command chains, substitutes or groups, each trimmed and collapsed. */
export const commandParts = (command: string): string[] =>
	command.split(PART_BREAK).map(collapse).filter(Boolean);

/** An absolute path with `/` separators, `~` expanded, `..` resolved, lowercased on Windows. */
export const normalizePath = (p: string, env: PathEnv): string => {
	const lib = env.platform === "win32" ? win32 : posix;
	const expanded = p === "~" || /^~[/\\]/.test(p) ? env.home + p.slice(1) : p;
	const abs = lib.resolve(env.workspaceDir, expanded).replaceAll("\\", "/");
	return env.platform === "win32" ? abs.toLowerCase() : abs;
};

// Longest token first. "**/" spans zero or more folders; a trailing "/**" (handled
// before the table) also matches the folder itself.
const TOKENS: ReadonlyArray<readonly [string, string]> = [
	["**/", "(?:.*/)?"],
	["**", ".*"],
	["*", "[^/]*"],
	["?", "[^/]"],
];

const toRegExp = (pattern: string): RegExp => {
	const dirAndBelow = pattern.endsWith("/**");
	const body = dirAndBelow ? pattern.slice(0, -3) : pattern;
	let re = "";
	for (let i = 0; i < body.length; ) {
		const hit = TOKENS.find(([token]) => body.startsWith(token, i));
		re += hit ? hit[1] : escapeRegex(body.charAt(i));
		i += hit ? hit[0].length : 1;
	}
	return new RegExp(`^${re}${dirAndBelow ? "(?:/.*)?" : ""}$`, "s");
};

/** File-glob match of a path pattern against a path, both normalized first. */
export const pathMatches = (
	pattern: string,
	path: string,
	env: PathEnv,
): boolean =>
	toRegExp(normalizePath(pattern, env)).test(normalizePath(path, env));

/** True when `path` is `dir` or below it; both must already be normalized. */
export const isInside = (dir: string, path: string): boolean =>
	path === dir || path.startsWith(`${dir.replace(/\/$/, "")}/`);
