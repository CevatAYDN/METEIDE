import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { err, ok, type Result } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { z } from "zod";

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

/** The snapshots of runs kept under `root`, for the workspace `workspaceDir`. */
export const createSnapshotStore = (root: string, workspaceDir: string) => {
	const p: Place = { root, workspaceDir };
	return {
		/** Opens the next snapshot of the run for a step and answers its ref. */
		open: (runId: string, step: number) => open(p, runId, step),
		/** Copies a file into the snapshot the first time it is kept there, or records its absence. */
		keep: (ref: string, path: string) => keep(p, ref, path),
	};
};

export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
