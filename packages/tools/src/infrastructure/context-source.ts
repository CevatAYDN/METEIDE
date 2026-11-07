import type { Stats } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { BINARY_SNIFF_BYTES } from "../defaults.js";
import { isBinary } from "../domain/text.js";
import { errnoOf } from "./errno.js";

/** Context failures never expose filesystem error details or source text (ADR-183). */
export const contextFailure = (error: unknown): ToolError => {
	const code = errnoOf(error);
	return {
		code: code === "ENOENT" || code === "ENOTDIR" ? "not_found" : "io",
		message: "Context source inspection failed",
	};
};

/** Native context operations retain Windows lock retries and check cancellation between attempts. */
export const contextAttempt = async <T>(
	run: () => Promise<T>,
	signal: AbortSignal,
): Promise<Result<T, ToolError>> => {
	try {
		const value = await withLockRetry(async () => {
			signal.throwIfAborted();
			return run();
		});
		signal.throwIfAborted();
		return ok(value);
	} catch (error) {
		return err(contextFailure(error));
	}
};

/** Only existing regular files with one link qualify as context sources (ADR-183). */
const fileKind = (source: Stats): Result<void, ToolError> => {
	if (source.isDirectory())
		return err({ code: "is_directory", message: "Context source is a folder" });
	if (!source.isFile())
		return err({
			code: "bad_input",
			message: "Context source is not a regular file",
		});
	if (source.nlink > 1)
		return err({
			code: "outside_workspace",
			message: "Context source has multiple links",
		});
	return ok(undefined);
};

/** Strict realpath resolution preserves missing, unreadable and loop failures. */
export const contextRealpath = (path: string, signal: AbortSignal) =>
	contextAttempt(() => realpath(path), signal);

/** Only existing regular files with one link qualify as context sources (ADR-183). */
export const contextSourceKind = async (
	path: string,
	signal: AbortSignal,
): Promise<Result<void, ToolError>> => {
	const source = await contextAttempt(() => stat(path), signal);
	return source.ok ? fileKind(source.value) : source;
};

const validPrefix = (
	bytes: Uint8Array,
	truncated: boolean,
): Result<void, ToolError> => {
	const binary: ToolError = {
		code: "binary",
		message: "Context source is not UTF-8 text",
	};
	if (isBinary(bytes)) return err(binary);
	try {
		// A bounded read may end inside a valid character; only an actual EOF must flush it.
		new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
			stream: truncated,
		});
		return ok(undefined);
	} catch {
		return err(binary);
	}
};

/** Reads at most the binary-sniff prefix and always closes its native handle (ADR-183). */
export const contextSourcePrefix = async (
	path: string,
	signal: AbortSignal,
): Promise<Result<void, ToolError>> => {
	const result = await contextAttempt(async () => {
		const file = await open(path, "r");
		try {
			signal.throwIfAborted();
			const metadata = await file.stat();
			const kind = fileKind(metadata);
			if (!kind.ok) return kind;
			const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
			let used = 0;
			while (used < buffer.length) {
				signal.throwIfAborted();
				const read = await file.read(buffer, used, buffer.length - used, used);
				if (read.bytesRead === 0) break;
				used += read.bytesRead;
			}
			return validPrefix(
				buffer.subarray(0, used),
				metadata.size > used && used === buffer.length,
			);
		} finally {
			await file.close();
		}
	}, signal);
	return result.ok ? result.value : result;
};
