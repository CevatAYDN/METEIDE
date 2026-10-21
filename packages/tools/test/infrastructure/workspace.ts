import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A temporary workspace and global folder; `put` writes files into the workspace. */
export const tempWorkspace = async () => {
	const base = await realpath(await mkdtemp(join(tmpdir(), "mete-tools-")));
	const workspaceDir = join(base, "ws");
	const globalDir = join(base, "global");
	await mkdir(workspaceDir);
	await mkdir(join(globalDir, "worktrees"), { recursive: true });
	const put = async (rel: string, text: string, root = workspaceDir) => {
		const file = join(root, rel);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, text);
		return file;
	};
	const close = () => rm(base, { recursive: true, force: true });
	return { workspaceDir, globalDir, put, close };
};
