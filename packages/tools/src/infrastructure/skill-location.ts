import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import {
	err,
	ok,
	type Result,
	type SkillError,
	type SkillSourceDescriptor,
	SkillSourceDescriptorSchema,
} from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { contextIgnoreRules } from "./context-ignore.js";
import { errnoOf } from "./errno.js";
import type { IgnoreCheck } from "./ignore-rules.js";

/** Composition-owned roots only; never a capability input. */
export type SkillRoots = {
	readonly workspaceDir: string;
	readonly globalDir: string;
};
/** Native locations remain internal and are re-enumerated for each source lookup. */
export type SkillLocation = {
	readonly source: SkillSourceDescriptor;
	readonly file: string;
	readonly metadata: BigIntStats;
};
/** Current root identity and current workspace ignore rules, private to native source code. */
export type SkillRoot = {
	readonly path: string;
	readonly scope: SkillSourceDescriptor["scope"];
	readonly identity: readonly string[];
	readonly ignored: IgnoreCheck;
};

/** Windows identity comparisons remove only namespace spelling and case aliases. */
export const skillComparable = (path: string) =>
	process.platform === "win32"
		? path
				.replaceAll("/", sep)
				.replace(/^\\\\\?\\UNC\\/iu, "\\\\")
				.replace(/^\\\\\?\\/u, "")
				.toLowerCase()
		: path;

/** Safe cancellable native operation with the existing Windows lock retry policy. */
export const skillAttempt = async <T>(
	run: () => Promise<T>,
	signal: AbortSignal,
	location?: SkillError["location"],
): Promise<Result<T, SkillError>> => {
	try {
		const value = await withLockRetry(async () => {
			signal.throwIfAborted();
			return run();
		});
		signal.throwIfAborted();
		return ok(value);
	} catch (error) {
		if (signal.aborted) return err({ code: "aborted" });
		const code = errnoOf(error) === "ENOENT" ? "not_found" : "unavailable";
		return err(location === undefined ? { code } : { code, location });
	}
};

const directory = async (path: string, signal: AbortSignal) => {
	const metadata = await skillAttempt(
		() => lstat(path, { bigint: true }),
		signal,
		"root",
	);
	if (!metadata.ok) return metadata;
	return metadata.value.isDirectory() && !metadata.value.isSymbolicLink()
		? metadata
		: err({ code: "unavailable" as const, location: "root" as const });
};

const ignoreRules = async (base: string, signal: AbortSignal) => {
	const rules = await skillAttempt(
		() => contextIgnoreRules(base, signal),
		signal,
		"root",
	);
	if (!rules.ok) return rules;
	return rules.value.ok
		? rules.value
		: err({ code: "unavailable" as const, location: "root" as const });
};

/** Checks the .mete/skills chain before anchoring a root to canonical path and dev/ino. */
export const skillRoot = async (
	opts: SkillRoots,
	scope: SkillSourceDescriptor["scope"],
	signal: AbortSignal,
): Promise<Result<SkillRoot, SkillError>> => {
	const base = await skillAttempt(
		() => realpath(scope === "workspace" ? opts.workspaceDir : opts.globalDir),
		signal,
		"root",
	);
	if (!base.ok) return base;
	const chain = scope === "workspace" ? [".mete", "skills"] : ["skills"];
	let path = base.value;
	for (const part of chain) {
		path = join(path, part);
		const checked = await directory(path, signal);
		if (!checked.ok) return checked;
	}
	const canonical = await skillAttempt(() => realpath(path), signal, "root");
	if (!canonical.ok) return canonical;
	const metadata = await directory(path, signal);
	if (!metadata.ok) return metadata;
	const rules =
		scope === "workspace"
			? await ignoreRules(base.value, signal)
			: ok<IgnoreCheck>(() => false);
	if (!rules.ok) return rules;
	return ok({
		path: canonical.value,
		scope,
		ignored: rules.value,
		identity: [
			skillComparable(canonical.value),
			String(metadata.value.dev),
			String(metadata.value.ino),
		],
	});
};

const sourceFile = async (file: string, signal: AbortSignal) => {
	const metadata = await skillAttempt(
		() => lstat(file, { bigint: true }),
		signal,
		"source",
	);
	if (!metadata.ok) return metadata;
	if (
		!metadata.value.isFile() ||
		metadata.value.isSymbolicLink() ||
		metadata.value.nlink !== 1n
	)
		return err({ code: "bad_input" as const, location: "source" as const });
	const canonical = await skillAttempt(() => realpath(file), signal, "source");
	return canonical.ok
		? ok({ file: canonical.value, metadata: metadata.value })
		: canonical;
};

/** Inspects only a direct child; no links, streams, hardlinks or nonregular files qualify. */
export const skillLocation = async (
	root: SkillRoot,
	name: string,
	signal: AbortSignal,
): Promise<Result<SkillLocation, SkillError>> => {
	const path = `${name}/SKILL.md`;
	const sourceId = createHash("sha256")
		.update(
			JSON.stringify([root.scope, ...root.identity, skillComparable(path)]),
		)
		.digest("hex");
	const parsed = SkillSourceDescriptorSchema.safeParse({
		sourceId,
		scope: root.scope,
		path,
	});
	if (!parsed.success) return err({ code: "bad_input", location: "path" });
	const child = join(root.path, name);
	const folder = await directory(child, signal);
	if (!folder.ok)
		return err({
			code: signal.aborted ? "aborted" : "bad_input",
			location: "source",
			sourceId,
		});
	const file = join(child, "SKILL.md");
	if (root.ignored(child, true) || root.ignored(file))
		return err({ code: "ignored", sourceId });
	const canonical = await sourceFile(file, signal);
	if (!canonical.ok) return err({ ...canonical.error, sourceId });
	if (
		basename(canonical.value.file) !== "SKILL.md" ||
		skillComparable(relative(root.path, canonical.value.file)) !==
			skillComparable(join(name, "SKILL.md"))
	)
		return err({ code: "bad_input", location: "path", sourceId });
	if (root.ignored(canonical.value.file))
		return err({ code: "ignored", sourceId });
	return ok({ source: parsed.data, ...canonical.value });
};
