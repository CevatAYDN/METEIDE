// `git status --porcelain=v1 -z --branch` as vcs.git@1 status output (docs/06).

type StatusFile = { path: string; index: string; worktree: string };

// "main...origin/main [ahead 1]", "No commits yet on main", "HEAD (no branch)".
const branchOf = (header: string): string | null => {
	if (header.startsWith("HEAD (no branch)")) return null;
	const name = header.replace(/^No commits yet on /, "");
	return name.split("...")[0]?.split(" ")[0] ?? null;
};

/** The branch (null when detached) and the changed files, untracked as "?" "?". */
export const parseStatus = (out: string) => {
	const parts = out.split("\0").filter((p) => p !== "");
	let branch: string | null = null;
	const files: StatusFile[] = [];
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i] ?? "";
		if (p.startsWith("## ")) {
			branch = branchOf(p.slice(3));
			continue;
		}
		const index = p[0] ?? " ";
		files.push({ path: p.slice(3), index, worktree: p[1] ?? " " });
		if (index === "R" || index === "C") i++; // the next part is the old path
	}
	return { branch, files };
};
