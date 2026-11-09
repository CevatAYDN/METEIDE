import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";
import {
	err,
	ok,
	type Result,
	SKILL_LIMITS,
	type SkillError,
	type SkillSourceSnapshot,
	SkillSourceSnapshotSchema,
} from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { resolveSkillLocation } from "./skill-enumeration.js";
import {
	type SkillLocation,
	type SkillRoots,
	skillAttempt,
	skillComparable,
} from "./skill-location.js";

type Held = { file: FileHandle; location: SkillLocation };
type ReaderOptions = SkillRoots & {
	readonly locate?: (
		input: unknown,
		signal: AbortSignal,
	) => Promise<Result<SkillLocation, SkillError>>;
};
const locate = (opts: ReaderOptions, input: unknown, signal: AbortSignal) =>
	opts.locate
		? opts.locate(input, signal)
		: resolveSkillLocation(opts, input, signal);
const regular = (metadata: BigIntStats) =>
	metadata.isFile() && metadata.nlink === 1n;
const unchanged = (left: BigIntStats, right: BigIntStats) =>
	left.dev === right.dev &&
	left.ino === right.ino &&
	left.size === right.size &&
	left.mtimeNs === right.mtimeNs &&
	left.ctimeNs === right.ctimeNs &&
	left.nlink === right.nlink;

const boundedBytes = async (
	file: FileHandle,
	signal: AbortSignal,
): Promise<Result<Buffer, SkillError>> => {
	const buffer = Buffer.alloc(SKILL_LIMITS.fileBytes + 1);
	let used = 0;
	while (used < buffer.length) {
		signal.throwIfAborted();
		const read = await file.read(buffer, used, buffer.length - used, used);
		signal.throwIfAborted();
		if (read.bytesRead === 0) break;
		used += read.bytesRead;
	}
	return used > SKILL_LIMITS.fileBytes
		? err({ code: "limit_exceeded", location: "source" })
		: ok(buffer.subarray(0, used));
};

const currentHeld = async (
	opts: ReaderOptions,
	held: Held,
	initial: BigIntStats,
	signal: AbortSignal,
): Promise<Result<void, SkillError>> => {
	const current = await locate(
		opts,
		{ sourceId: held.location.source.sourceId },
		signal,
	);
	if (!current.ok) return current;
	const path = await lstat(current.value.file, { bigint: true });
	signal.throwIfAborted();
	const descriptor = await held.file.stat({ bigint: true });
	signal.throwIfAborted();
	if (
		!regular(path) ||
		!regular(descriptor) ||
		!unchanged(initial, path) ||
		!unchanged(initial, descriptor) ||
		skillComparable(current.value.file) !== skillComparable(held.location.file)
	)
		return err({ code: "stale", location: "source" });
	return ok(undefined);
};

const snapshot = (
	location: SkillLocation,
	bytes: Buffer,
): Result<SkillSourceSnapshot, SkillError> => {
	try {
		if (bytes.includes(0)) return err({ code: "bad_input", location: "utf8" });
		const text = new TextDecoder("utf-8", {
			fatal: true,
			ignoreBOM: true,
		}).decode(bytes);
		const parsed = SkillSourceSnapshotSchema.safeParse({
			source: location.source,
			text,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
		return parsed.success
			? ok(parsed.data)
			: err({ code: "bad_input", location: "utf8" });
	} catch {
		return err({ code: "bad_input", location: "utf8" });
	}
};

const readHeld = async (
	opts: ReaderOptions,
	held: Held,
	signal: AbortSignal,
): Promise<Result<SkillSourceSnapshot, SkillError>> => {
	signal.throwIfAborted();
	const initial = await held.file.stat({ bigint: true });
	signal.throwIfAborted();
	if (!regular(initial)) return err({ code: "bad_input", location: "source" });
	if (!unchanged(held.location.metadata, initial))
		return err({ code: "stale", location: "source" });
	if (initial.size > BigInt(SKILL_LIMITS.fileBytes))
		return err({ code: "limit_exceeded", location: "source" });
	const bytes = await boundedBytes(held.file, signal);
	if (!bytes.ok) return bytes;
	const checked = await currentHeld(opts, held, initial, signal);
	return checked.ok ? snapshot(held.location, bytes.value) : checked;
};

const readFixed = async (
	opts: ReaderOptions,
	location: SkillLocation,
	signal: AbortSignal,
) => {
	const file = await open(location.file, "r");
	try {
		return await readHeld(opts, { file, location }, signal);
	} finally {
		await withLockRetry(() => file.close());
	}
};

/** Exact bounded native snapshot; revalidates current source and held descriptor before returning bytes. */
export const readSkillSource = async (
	opts: ReaderOptions,
	input: unknown,
	signal: AbortSignal,
): Promise<Result<SkillSourceSnapshot, SkillError>> => {
	const location = await locate(opts, input, signal);
	if (!location.ok) return location;
	const read = await skillAttempt(
		() => readFixed(opts, location.value, signal),
		signal,
		"source",
	);
	return read.ok ? read.value : read;
};
