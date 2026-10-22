import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Binary tool results go to .mete/assets/ with one line each in manifest.jsonl (docs/10, content types).
// shortcut: lines are appended without a lock, small appends do not interleave in practice; upgrade with a lock if the Assets view finds torn lines (Phase 5).
// shortcut: no license field, an MCP result carries none; it joins with the Assets view (docs/13).

/** The call that produced an asset; only the call knows it, so it is written with the file. */
export type Origin = {
	readonly server: string;
	readonly tool: string;
	readonly runId?: string;
};

/** Where assets go and which call they came from. */
export type AssetSink = {
	readonly workspaceDir: string;
	readonly origin: Origin;
};

/** A file name extension for a media type, `bin` when it has no plain subtype. */
export const extensionOf = (mediaType: string) =>
	/^[a-z]+\/([a-z0-9]+)/i.exec(mediaType)?.[1]?.toLowerCase() ?? "bin";

/** Saves base64 data under .mete/assets/, notes it in the manifest and returns its workspace-relative path. */
export const saveAsset = async (
	sink: AssetSink,
	base64: string,
	mediaType: string,
) => {
	const bytes = Buffer.from(base64, "base64");
	const name = `${randomUUID()}.${extensionOf(mediaType)}`;
	const dir = join(sink.workspaceDir, ".mete", "assets");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, name), bytes);
	const path = `.mete/assets/${name}`;
	const entry = {
		path,
		mediaType,
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		...sink.origin,
		at: new Date().toISOString(),
	};
	await appendFile(join(dir, "manifest.jsonl"), `${JSON.stringify(entry)}\n`);
	return path;
};
