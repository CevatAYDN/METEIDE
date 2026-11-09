import type { Dir } from "node:fs";
import { opendir } from "node:fs/promises";
import {
	err,
	ok,
	type Result,
	type SkillError,
	SkillSourceInputSchema,
	type SkillSourceList,
	SkillSourceListSchema,
} from "@mete/contracts";
import { SKILL_ROOT_ENTRIES } from "../defaults.js";
import {
	type SkillLocation,
	type SkillRoot,
	type SkillRoots,
	skillAttempt,
	skillComparable,
	skillLocation,
	skillRoot,
} from "./skill-location.js";

type Scan = {
	locations: SkillLocation[];
	diagnostics: SkillError[];
	complete: boolean;
};
type Inventory = { list: SkillSourceList; locations: SkillLocation[] };

const addCandidate = async (
	root: SkillRoot,
	name: string,
	scan: Scan,
	signal: AbortSignal,
): Promise<Result<void, SkillError>> => {
	const location = await skillLocation(root, name, signal);
	if (location.ok) scan.locations.push(location.value);
	else {
		if (location.error.code === "aborted") return location;
		if (location.error.code !== "not_found")
			scan.diagnostics.push(location.error);
	}
	return ok(undefined);
};

const scanDirectory = async (
	directory: Dir,
	root: SkillRoot,
	signal: AbortSignal,
): Promise<Result<Scan, SkillError>> => {
	const scan: Scan = { locations: [], diagnostics: [], complete: true };
	for (let count = 0; count < SKILL_ROOT_ENTRIES; count++) {
		signal.throwIfAborted();
		const entry = await directory.read();
		if (entry === null) return ok(scan);
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		const added = await addCandidate(root, entry.name, scan, signal);
		if (!added.ok) return added;
	}
	// Never examine entry 257; the exact ceiling is conservative too.
	scan.complete = false;
	scan.diagnostics.push({ code: "limit_exceeded", location: "root" });
	return ok(scan);
};

const scanRoot = async (root: SkillRoot, signal: AbortSignal) => {
	const result = await skillAttempt(
		async () => {
			const directory = await opendir(root.path, { bufferSize: 1 });
			try {
				return await scanDirectory(directory, root, signal);
			} finally {
				await directory.close();
			}
		},
		signal,
		"root",
	);
	return result.ok ? result.value : result;
};

const currentRootScan = async (
	opts: SkillRoots,
	scope: SkillRoot["scope"],
	signal: AbortSignal,
): Promise<Result<Scan, SkillError>> => {
	const root = await skillRoot(opts, scope, signal);
	if (!root.ok)
		return root.error.code === "not_found"
			? ok({ locations: [], diagnostics: [], complete: true })
			: root;
	const scan = await scanRoot(root.value, signal);
	if (!scan.ok) return scan;
	const current = await skillRoot(opts, scope, signal);
	if (!current.ok) return current;
	if (
		JSON.stringify(root.value.identity) !==
		JSON.stringify(current.value.identity)
	)
		return err({ code: "stale", location: "root" });
	return scan;
};

const mergeScan = (inventory: Inventory, scan: Scan, seen: Set<string>) => {
	inventory.list.complete &&= scan.complete;
	inventory.list.diagnostics.push(...scan.diagnostics);
	for (const location of scan.locations) {
		const key = skillComparable(location.file);
		if (seen.has(key)) {
			inventory.list.diagnostics.push({ code: "bad_input", location: "path" });
			continue;
		}
		seen.add(key);
		inventory.locations.push(location);
		inventory.list.sources.push(location.source);
	}
};

const enumerate = async (
	opts: SkillRoots,
	signal: AbortSignal,
): Promise<Result<Inventory, SkillError>> => {
	const inventory: Inventory = {
		list: { sources: [], diagnostics: [], complete: true },
		locations: [],
	};
	const seen = new Set<string>();
	for (const scope of ["workspace", "global"] as const) {
		const scan = await currentRootScan(opts, scope, signal);
		if (!scan.ok) return scan;
		mergeScan(inventory, scan.value, seen);
	}
	if (signal.aborted) return err({ code: "aborted" });
	const parsed = SkillSourceListSchema.safeParse(inventory.list);
	return parsed.success
		? ok({ list: parsed.data, locations: inventory.locations })
		: err({ code: "unavailable" });
};

/** Safe source inventory only; absolute native locations never leave this helper. */
export const listSkillSources = async (
	opts: SkillRoots,
	signal: AbortSignal,
): Promise<Result<SkillSourceList, SkillError>> => {
	const inventory = await enumerate(opts, signal);
	return inventory.ok ? ok(inventory.value.list) : inventory;
};

/** Resolves an opaque ID from a fresh complete inventory, without caching or reading bytes. */
export const resolveSkillLocation = async (
	opts: SkillRoots,
	input: unknown,
	signal: AbortSignal,
): Promise<Result<SkillLocation, SkillError>> => {
	if (signal.aborted) return err({ code: "aborted" });
	const parsed = SkillSourceInputSchema.safeParse(input);
	if (!parsed.success) return err({ code: "bad_input" });
	const inventory = await enumerate(opts, signal);
	if (!inventory.ok) return inventory;
	if (!inventory.value.list.complete)
		return err({ code: "limit_exceeded", location: "root" });
	const sourceId = parsed.data.sourceId;
	const location = inventory.value.locations.find(
		(candidate) => candidate.source.sourceId === sourceId,
	);
	if (location) return ok(location);
	const diagnostic = inventory.value.list.diagnostics.find(
		(candidate) => candidate.sourceId === sourceId,
	);
	return err(diagnostic ?? { code: "not_found" });
};
