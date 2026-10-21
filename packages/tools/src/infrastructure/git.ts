import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { simpleGit } from "simple-git";

// git through simple-git (docs/05, docs/10 Built-in tools).

// Inherited GIT_* variables could point git at another repository or index, and editors
// or pagers would wait for a person; simple-git also refuses most of them.
const DROPPED = /^(GIT_.*|EDITOR|VISUAL|PAGER|PREFIX|SSH_ASKPASS)$/i;

const inherited = () =>
	Object.fromEntries(
		Object.entries(process.env).filter(
			(e): e is [string, string] => e[1] !== undefined && !DROPPED.test(e[0]),
		),
	);

/** Runs one git command in `root`; `env` adds variables such as GIT_INDEX_FILE. */
export type Git = (
	args: readonly string[],
	env?: Readonly<Record<string, string>>,
) => Promise<Result<string, ToolError>>;

/** A git runner for the repository at `root`, cancelled by `signal`. */
export const gitAt =
	(root: string, signal?: AbortSignal): Git =>
	async (args, env = {}) => {
		try {
			const git = simpleGit({
				baseDir: root,
				// simple-git guards GIT_* variables; only the ones METE sets itself pass.
				allowEnvironment: Object.keys(env),
				...(signal ? { abort: signal } : {}),
			});
			return ok(await git.env({ ...inherited(), ...env }).raw([...args]));
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return err({ code: "io", message: `git ${args[0]}: ${message.trim()}` });
		}
	};

/** The repository root holding `dir`, or why there is none (not a repository, no git). */
export const repoRoot = async (
	dir: string,
): Promise<Result<string, ToolError>> => {
	const r = await gitAt(dir)(["rev-parse", "--show-toplevel"]);
	return r.ok ? ok(r.value.trim()) : r;
};

/** NUL-separated git output as a list. */
export const zList = (out: string) => out.split("\0").filter((p) => p !== "");
