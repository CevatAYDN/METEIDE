import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { err, ok, type Result } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { z } from "zod";
import type { RestoreStep, Snapshot } from "../domain/snapshot-plan.js";

// File snapshots for a folder that is not a git repository (ADR-080; SECURITY.md, Checkpoints and
// rollback), in the global snapshots/<run id>/<n>/ folder: manifest.json names the step and each file
// the step wrote, as it was before (or that it did not exist), and files/ holds the copies.

const MANIFEST = "manifest.json";
const FILES = "files";

// The manifest is read back from disk, so it is parsed (golden rule 5).
const ManifestSchema = z.strictObject({
	step: z.number().int(),
	entries: z.array(
		z.strictObject({ path: z.string().min(1), existed: z.boolean() }),
	),
});
type Manifest = z.infer<typeof ManifestSchema>;

/** Why a snapshot could not be read, written or restored. */
export type SnapshotError = {
	readonly code: "not_found" | "io";
	readonly message: string;
};

/** Where the snapshots live and which workspace they copy from. */
type Place = { readonly root: string; readonly workspaceDir: string };

const io = (e: unknown): SnapshotError => ({ code: "io", message: String(e) });

/** The ref of snapshot n of a run, as checkpoint.created carries it. */
export const snapshotRef = (runId: string, n: number) =>
	`snapshots/${runId}/${n}`;

const dirOf = (p: Place, ref: string) =>
	join(p.root, ...ref.split("/").slice(1));

// A path relative to the workspace with forward slashes, or undefined outside it.
const inside = (p: Place, path: string) => {
	const rel = relative(p.workspaceDir, resolve(p.workspaceDir, path));
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return rel.split(sep).join("/");
};

const readManifest = async (dir: string) =>
	ManifestSchema.parse(JSON.parse(await readFile(join(dir, MANIFEST), "utf8")));

const writeManifest = (dir: string, m: Manifest) =>
	withLockRetry(() => writeFile(join(dir, MANIFEST), JSON.stringify(m)));

/** The numbers of a run's snapshots, none when it has no folder. */
const numbers = async (p: Place, runId: string) => {
	try {
		const names = await readdir(join(p.root, runId));
		return names.filter((n) => /^\d+$/.test(n)).map(Number);
	} catch {
		return [];
	}
};

// Opens the next snapshot of the run for a step and answers its ref.
const open = async (
	p: Place,
	runId: string,
	step: number,
): Promise<Result<string, SnapshotError>> => {
	try {
		const n = Math.max(0, ...(await numbers(p, runId))) + 1;
		const dir = join(p.root, runId, String(n));
		await mkdir(dir, { recursive: true });
		await writeManifest(dir, { step, entries: [] });
		return ok(snapshotRef(runId, n));
	} catch (e) {
		return err(io(e));
	}
};

// The file's copy, or false when it did not exist.
const copied = (from: string, to: string) =>
	copyFile(from, to).then(
		() => true,
		(e: NodeJS.ErrnoException) => {
			if (e.code === "ENOENT") return false;
			throw e;
		},
	);

// Copies a file into the snapshot the first time it is kept there, or records its absence.
const keep = async (
	p: Place,
	ref: string,
	path: string,
): Promise<Result<void, SnapshotError>> => {
	const rel = inside(p, path);
	if (rel === undefined) return ok(undefined);
	const dir = dirOf(p, ref);
	try {
		const m = await readManifest(dir);
		if (m.entries.some((e) => e.path === rel)) return ok(undefined);
		const copy = join(dir, FILES, rel);
		await mkdir(dirname(copy), { recursive: true });
		const existed = await copied(join(p.workspaceDir, rel), copy);
		const entries = [...m.entries, { path: rel, existed }];
		await writeManifest(dir, { ...m, entries });
		return ok(undefined);
	} catch (e) {
		return err(io(e));
	}
};

// Every snapshot of the run with its files, in number order.
const load = async (
	p: Place,
	runId: string,
): Promise<Result<readonly Snapshot[], SnapshotError>> => {
	try {
		const ns = (await numbers(p, runId)).sort((a, b) => a - b);
		const read = ns.map(async (n) => ({
			n,
			entries: (await readManifest(join(p.root, runId, String(n)))).entries,
		}));
		return ok(await Promise.all(read));
	} catch (e) {
		return err(io(e));
	}
};

// Writes back or deletes each file of a restore plan.
const apply = async (
	p: Place,
	runId: string,
	plan: readonly RestoreStep[],
): Promise<Result<void, SnapshotError>> => {
	try {
		for (const step of plan) {
			const target = join(p.workspaceDir, step.path);
			if ("delete" in step)
				await withLockRetry(() => rm(target, { force: true }));
			else {
				const copy = join(p.root, runId, String(step.from), FILES, step.path);
				await mkdir(dirname(target), { recursive: true });
				await withLockRetry(() => copyFile(copy, target));
			}
		}
		return ok(undefined);
	} catch (e) {
		return err(io(e));
	}
};

// A new snapshot of the files as they are now, for no step: the undo of a restore (ADR-079).
const capture = async (
	p: Place,
	runId: string,
	paths: readonly string[],
): Promise<Result<string, SnapshotError>> => {
	const opened = await open(p, runId, -1);
	if (!opened.ok) return opened;
	for (const path of paths) {
		const kept = await keep(p, opened.value, path);
		if (!kept.ok) return kept;
	}
	return opened;
};

/** The snapshots of runs kept under `root`, for the workspace `workspaceDir`. */
export const createSnapshotStore = (root: string, workspaceDir: string) => {
	const p: Place = { root, workspaceDir };
	return {
		/** Opens the next snapshot of the run for a step and answers its ref. */
		open: (runId: string, step: number) => open(p, runId, step),
		/** Copies a file into the snapshot the first time it is kept there, or records its absence. */
		keep: (ref: string, path: string) => keep(p, ref, path),
		/** Every snapshot of the run with its files, in number order. */
		load: (runId: string) => load(p, runId),
		/** Writes back or deletes each file of a restore plan. */
		apply: (runId: string, plan: readonly RestoreStep[]) =>
			apply(p, runId, plan),
		/** A new snapshot of the files as they are now: the undo of a restore. */
		capture: (runId: string, paths: readonly string[]) =>
			capture(p, runId, paths),
		/** Removes every snapshot of the run (the 14-day prune). */
		prune: (runId: string) =>
			withLockRetry(() =>
				rm(join(p.root, runId), { recursive: true, force: true }),
			),
	};
};

export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
