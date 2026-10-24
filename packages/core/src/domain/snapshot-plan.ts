// What restoring file snapshot n does (ADR-080). A snapshot holds only the files its step wrote, as
// they were before it, so restoring n undoes every step from n on: each file of the snapshots n and
// later goes back to the version in the lowest of them that holds it, or is deleted where that
// snapshot recorded that it did not exist. Pure.

/** One file a snapshot recorded: its path relative to the workspace, and whether it existed. */
export type SnapshotEntry = {
	readonly path: string;
	readonly existed: boolean;
};

/** A snapshot of a run by its number, with the files it recorded. */
export type Snapshot = {
	readonly n: number;
	readonly entries: readonly SnapshotEntry[];
};

/** What happens to one file: copied back from snapshot `from`, or deleted. */
export type RestoreStep =
	| { readonly path: string; readonly from: number }
	| { readonly path: string; readonly delete: true };

/** The files restoring snapshot `n` writes back or deletes, in path order. */
export const restorePlan = (
	snapshots: readonly Snapshot[],
	n: number,
): readonly RestoreStep[] => {
	const first = new Map<string, RestoreStep>();
	for (const s of [...snapshots]
		.filter((s) => s.n >= n)
		.sort((a, b) => a.n - b.n))
		for (const e of s.entries)
			if (!first.has(e.path))
				first.set(
					e.path,
					e.existed
						? { path: e.path, from: s.n }
						: { path: e.path, delete: true },
				);
	return [...first.values()].sort((a, b) => a.path.localeCompare(b.path));
};
