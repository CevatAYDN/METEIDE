import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Binary tool results go to .mete/assets/ (docs/10, content types).
// shortcut: no manifest entry is written, docs/10 names one but defines no format; add it when a tab does.

/** A file name extension for a media type, `bin` when it has no plain subtype. */
export const extensionOf = (mediaType: string) =>
	/^[a-z]+\/([a-z0-9]+)/i.exec(mediaType)?.[1]?.toLowerCase() ?? "bin";

/** Saves base64 data under .mete/assets/ and returns its workspace-relative path. */
export const saveAsset = async (
	workspaceDir: string,
	base64: string,
	mediaType: string,
) => {
	const name = `${randomUUID()}.${extensionOf(mediaType)}`;
	const dir = join(workspaceDir, ".mete", "assets");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, name), Buffer.from(base64, "base64"));
	return `.mete/assets/${name}`;
};
