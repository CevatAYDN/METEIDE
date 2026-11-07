import { createHash, randomUUID } from "node:crypto";
import {
	err,
	ok,
	type Result,
	type SecretError,
	type SecretStore,
} from "@mete/contracts";
import { z } from "zod";
import { CREDENTIAL_MAX_PIECES, CREDENTIAL_PIECE_CHARS } from "../defaults.js";
import { credentialRecordQueue } from "./credential-record-queue.js";

const PiecesSchema = z.strictObject({
	generation: z.uuid(),
	count: z.number().int().min(1).max(CREDENTIAL_MAX_PIECES),
});
const ManifestSchema = z
	.strictObject({
		...PiecesSchema.shape,
		checksum: z.string().regex(/^[a-f0-9]{64}$/),
		cleanup: PiecesSchema.optional(),
	})
	.refine((record) => record.cleanup?.generation !== record.generation);
type Manifest = z.infer<typeof ManifestSchema>;
type Pieces = z.infer<typeof PiecesSchema>;
const failed = (message: string) =>
	err<SecretError>({ code: "secret_failed", message });
const checksum = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const pieceKey = (name: string, manifest: Pieces, index: number) =>
	`${name}/${manifest.generation}/${index}`;

const safe = async <T>(
	run: () => Promise<Result<T, SecretError>>,
	message: string,
): Promise<Result<T, SecretError>> => {
	try {
		const result = await run();
		return result.ok ? result : failed(message);
	} catch {
		return failed(message);
	}
};

const manifestFor = async (
	secrets: SecretStore,
	name: string,
): Promise<Result<Manifest | undefined, SecretError>> => {
	const result = await safe(
		() => secrets.get(`${name}/manifest`),
		"Credential read failed",
	);
	if (!result.ok) return result;
	if (result.value === undefined) return ok(undefined);
	if (result.value.length > CREDENTIAL_PIECE_CHARS)
		return failed("Credential record corrupt");
	try {
		const parsed = ManifestSchema.safeParse(JSON.parse(result.value));
		return parsed.success
			? ok(parsed.data)
			: failed("Credential record corrupt");
	} catch {
		return failed("Credential record corrupt");
	}
};

const readRecord = async (
	secrets: SecretStore,
	name: string,
): Promise<Result<string | undefined, SecretError>> => {
	const result = await manifestFor(secrets, name);
	if (!result.ok) return result;
	if (result.value === undefined) return ok(undefined);
	const manifest = result.value;
	let text = "";
	for (let index = 0; index < manifest.count; index++) {
		const piece = await safe(
			() => secrets.get(pieceKey(name, manifest, index)),
			"Credential read failed",
		);
		if (!piece.ok) return piece;
		const parsed = z
			.string()
			.max(CREDENTIAL_PIECE_CHARS)
			.safeParse(piece.value);
		if (!parsed.success) return failed("Credential record corrupt");
		text += parsed.data;
	}
	return checksum(text) === manifest.checksum
		? ok(text)
		: failed("Credential record corrupt");
};

const removePieces = async (
	secrets: SecretStore,
	name: string,
	manifest: Pieces,
) => {
	let complete = true;
	for (let index = 0; index < manifest.count; index++) {
		const result = await safe(
			() => secrets.delete(pieceKey(name, manifest, index)),
			"Credential cleanup failed",
		);
		if (!result.ok) complete = false;
	}
	return complete;
};

const stagingFor = async (secrets: SecretStore, name: string) => {
	const read = await safe(
		() => secrets.get(`${name}/staging`),
		"Credential cleanup read failed",
	);
	if (!read.ok) return read;
	if (read.value === undefined) return ok(undefined);
	try {
		const parsed = PiecesSchema.safeParse(JSON.parse(read.value));
		return parsed.success
			? ok(parsed.data)
			: failed("Credential staging record corrupt");
	} catch {
		return failed("Credential staging record corrupt");
	}
};

const clearStaging = (secrets: SecretStore, name: string) =>
	safe(
		() => secrets.delete(`${name}/staging`),
		"Credential cleanup incomplete",
	);

const prepareWrite = async (
	secrets: SecretStore,
	name: string,
): Promise<Result<Manifest | undefined, SecretError>> => {
	const prior = await manifestFor(secrets, name);
	if (!prior.ok) return prior;
	const staged = await stagingFor(secrets, name);
	if (!staged.ok) return staged;
	// A crash after publication may leave staging pointing at the usable generation.
	if (
		staged.value &&
		staged.value.generation !== prior.value?.generation &&
		!(await removePieces(secrets, name, staged.value))
	)
		return failed("Credential cleanup incomplete; write not committed");
	if (staged.value && !(await clearStaging(secrets, name)).ok)
		return failed("Credential cleanup incomplete; write not committed");
	if (
		prior.value?.cleanup &&
		!(await removePieces(secrets, name, prior.value.cleanup))
	)
		return failed("Credential cleanup incomplete; write not committed");
	return prior;
};

const stage = async (
	secrets: SecretStore,
	name: string,
	pieces: readonly string[],
	commit: { readonly manifest: Manifest; readonly signal: AbortSignal },
): Promise<Result<void, SecretError>> => {
	for (let index = 0; index < commit.manifest.count; index++) {
		if (commit.signal.aborted) return failed("Credential write cancelled");
		const piece = pieces[index] ?? "";
		const result = await safe(
			() => secrets.set(pieceKey(name, commit.manifest, index), piece),
			"Credential write failed",
		);
		if (!result.ok) return result;
	}
	if (commit.signal.aborted) return failed("Credential write cancelled");
	return safe(
		() => secrets.set(`${name}/manifest`, JSON.stringify(commit.manifest)),
		"Credential write failed",
	);
};

const piecesOf = (value: string) => {
	const pieces: string[] = [];
	let offset = 0;
	while (offset < value.length) {
		let end = Math.min(value.length, offset + CREDENTIAL_PIECE_CHARS);
		const last = value.charCodeAt(end - 1);
		if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
		pieces.push(value.slice(offset, end));
		offset = end;
	}
	return pieces.length ? pieces : [""];
};

const writeRecord = async (
	secrets: SecretStore,
	name: string,
	value: string,
	signal: AbortSignal,
): Promise<Result<void, SecretError>> => {
	if (value.length > CREDENTIAL_PIECE_CHARS * CREDENTIAL_MAX_PIECES)
		return failed("Credential record too large");
	if (signal.aborted) return failed("Credential write cancelled");
	const pieces = piecesOf(value);
	if (pieces.length > CREDENTIAL_MAX_PIECES)
		return failed("Credential record too large");
	const prior = await prepareWrite(secrets, name);
	if (!prior.ok) return prior;
	if (signal.aborted) return failed("Credential write cancelled");
	const manifest = {
		generation: randomUUID(),
		count: pieces.length,
		checksum: checksum(value),
		...(prior.value
			? {
					cleanup: {
						generation: prior.value.generation,
						count: prior.value.count,
					},
				}
			: {}),
	};
	const staged = await safe(
		() =>
			secrets.set(
				`${name}/staging`,
				JSON.stringify({
					generation: manifest.generation,
					count: manifest.count,
				}),
			),
		"Credential write failed",
	);
	if (!staged.ok) return staged;
	const saved = await stage(secrets, name, pieces, { manifest, signal });
	return finishWrite(
		secrets,
		name,
		{ manifest, prior: prior.value, saved },
		signal,
	);
};

const rollbackPublication = async (
	secrets: SecretStore,
	name: string,
	manifest: Manifest,
	prior: Manifest | undefined,
): Promise<Result<void, SecretError>> => {
	// Final marker deletion may already have completed when cancellation arrives.
	const marked = await safe(
		() =>
			secrets.set(
				`${name}/staging`,
				JSON.stringify({
					generation: manifest.generation,
					count: manifest.count,
				}),
			),
		"Credential rollback metadata failed; publication may remain",
	);
	if (!marked.ok) return marked;
	const restored = prior
		? await safe(
				() => secrets.set(`${name}/manifest`, JSON.stringify(prior)),
				"Credential rollback failed; publication may remain",
			)
		: await safe(
				() => secrets.delete(`${name}/manifest`),
				"Credential rollback failed; publication may remain",
			);
	// If restore failed, both generations and the staging marker must remain recoverable.
	if (!restored.ok) return restored;
	if (
		!(await removePieces(secrets, name, manifest)) ||
		!(await clearStaging(secrets, name)).ok
	)
		return failed("Credential rollback restored; staged cleanup incomplete");
	return failed("Credential write cancelled");
};

const finishWrite = async (
	secrets: SecretStore,
	name: string,
	result: {
		manifest: Manifest;
		prior: Manifest | undefined;
		saved: Result<void, SecretError>;
	},
	signal: AbortSignal,
): Promise<Result<void, SecretError>> => {
	const { manifest, prior, saved } = result;
	if (!saved.ok) {
		if (
			(await removePieces(secrets, name, manifest)) &&
			(await clearStaging(secrets, name)).ok
		)
			return saved;
		return failed("Credential write failed; staged cleanup incomplete");
	}
	if (signal.aborted)
		return rollbackPublication(secrets, name, manifest, prior);
	// Keep the one prior generation until the next mutation, so late cancellation can restore it.
	const cleared = await clearStaging(secrets, name);
	if (signal.aborted)
		return rollbackPublication(secrets, name, manifest, prior);
	if (!cleared.ok)
		return failed("Credential committed; staging cleanup incomplete");
	return ok(undefined);
};

const deleteRecord = async (
	secrets: SecretStore,
	name: string,
): Promise<Result<void, SecretError>> => {
	const manifest = await manifestFor(secrets, name);
	if (!manifest.ok) return manifest;
	const staged = await stagingFor(secrets, name);
	if (!staged.ok) return staged;
	const known = [staged.value, manifest.value?.cleanup, manifest.value].filter(
		(value): value is Pieces => value !== undefined,
	);
	// Missing pieces count as removed, so a partial deletion can be retried.
	let complete = true;
	for (const generation of known) {
		if (!(await removePieces(secrets, name, generation))) complete = false;
	}
	if (!complete) return failed("Credential cleanup incomplete");
	if (staged.value && !(await clearStaging(secrets, name)).ok)
		return failed("Credential cleanup incomplete");
	if (!manifest.value) return ok(undefined);
	const removed = await safe(
		() => secrets.delete(`${name}/manifest`),
		"Credential cleanup incomplete",
	);
	return removed.ok ? ok(undefined) : removed;
};

/**
 * Creates bounded, manifest-last records; all instances serialize per SecretStore and name.
 * Cancellation during publication restores the prior manifest before cleanup and drain complete.
 * After uncancelled publication completes, a successful write stays committed
 * even when it returns "Credential committed; staging cleanup incomplete".
 * One prior generation remains manifest-discoverable for deletion/retry across instances.
 * A value-free staging marker keeps failed writes discoverable after process restart.
 * Delete retains the manifest on incomplete cleanup; callers supply exact profile names.
 */
export const createCredentialRecords = (secrets: SecretStore) => {
	const queue = credentialRecordQueue(secrets);
	return {
		read: (name: string): Promise<Result<string | undefined, SecretError>> =>
			queue.read(name, () => readRecord(secrets, name)),
		write: (
			name: string,
			value: string,
			signal: AbortSignal,
		): Promise<Result<void, SecretError>> =>
			queue.mutate(name, () => writeRecord(secrets, name, value, signal)),
		/** A write-only patch sees current data inside the same per-profile mutation queue. */
		update: (
			name: string,
			merge: (current: string | undefined) => Result<string, SecretError>,
			signal: AbortSignal,
		): Promise<Result<void, SecretError>> =>
			queue.mutate(name, async () => {
				const current = await readRecord(secrets, name);
				if (!current.ok) return current;
				const next = merge(current.value);
				return next.ok ? writeRecord(secrets, name, next.value, signal) : next;
			}),
		delete: (name: string): Promise<Result<void, SecretError>> =>
			queue.mutate(name, () => deleteRecord(secrets, name)),
		/** Drains this store's queues; unresolved mutation failures survive reads and clean cancellation. */
		settled: (): Promise<Result<void, SecretError>> => queue.settled(),
	};
};
