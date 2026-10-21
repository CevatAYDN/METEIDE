import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// The user's global git config (identity, hooks, autocrlf) must not reach the tests:
// git reads it from HOME, so point HOME at an empty folder with a test identity.
export const isolateGit = async () => {
	const home = await mkdtemp(join(tmpdir(), "mete-home-"));
	await writeFile(
		join(home, ".gitconfig"),
		"[user]\n\tname = Test\n\temail = test@example.com\n",
	);
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	return home;
};

/** `git init` in `dir` with LF line endings kept as they are. */
export const initRepo = async (dir: string) => {
	await run("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
	await run("git", ["config", "core.autocrlf", "false"], { cwd: dir });
};
