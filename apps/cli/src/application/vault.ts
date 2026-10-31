import { restoreVersion, versionsOf } from "@mete/knowledge";
import { usage } from "../usage.js";
import type { Io } from "./commands.js";

// `mete vault restore <note path> [<timestamp>]` (docs/11, Aging and restore; ADR-173): the versions
// .history/ keeps of a workspace vault note, newest first, or one of them brought back.

const listed = async (dir: string, io: Io, path: string) => {
	const r = await versionsOf(dir, path);
	if (!r.ok) {
		io.err(r.error);
		return 1;
	}
	if (r.value.length === 0) io.out(`${path} has no earlier versions.`);
	for (const stamp of r.value) io.out(stamp);
	return 0;
};

/** Lists a note's versions, or restores one; exits 1 for a path outside the vault or an unknown version. */
export const vaultCommand = async (
	workspaceDir: string,
	io: Io,
	[sub, path, stamp]: readonly string[],
) => {
	if (sub !== "restore" || !path) return usage(io);
	if (!stamp) return listed(workspaceDir, io, path);
	const r = await restoreVersion(workspaceDir, path, stamp, Date.now());
	if (!r.ok) {
		io.err(r.error);
		return 1;
	}
	io.out(`${path} is back as it was at ${stamp}.`);
	if (r.value.kept) io.out(`What it held before is kept as ${r.value.kept}.`);
	return 0;
};
