import { z } from "zod";

// The Assets view's rows (docs/13, Assets; ADR-114): the files tools save under .mete/assets/,
// newest first, joined with the manifest the MCP client writes (one JSON line per binary result).

/** One line of .mete/assets/manifest.jsonl, as the MCP client writes it (packages/mcp). */
export const ManifestEntrySchema = z.strictObject({
	path: z.string().min(1),
	mediaType: z.string().min(1),
	bytes: z.number().int().nonnegative(),
	sha256: z.string().optional(),
	server: z.string().min(1),
	tool: z.string().min(1),
	runId: z.string().optional(),
	at: z.string().min(1),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/** A file of the folder as Theia's FileService lists it. */
export type AssetFile = {
	readonly name: string;
	readonly bytes: number;
	readonly mtime?: number;
};

/** A row of the view: a saved file and what the manifest knows of it. */
export type AssetRow = {
	readonly path: string;
	readonly name: string;
	readonly mediaType: string;
	readonly bytes: number;
	/** True for an image, which the row shows as its picture. */
	readonly image: boolean;
	/** ISO 8601: the manifest's time, or the file's. */
	readonly at?: string;
	readonly origin?: { readonly server: string; readonly tool: string };
};

// The media types of the files METE writes and the tools return.
const MEDIA: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
	avif: "image/avif",
	glb: "model/gltf-binary",
	gltf: "model/gltf+json",
	json: "application/json",
	jsonl: "application/jsonl",
	md: "text/markdown",
	txt: "text/plain",
	html: "text/html",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	mp4: "video/mp4",
	webm: "video/webm",
};

/** The media type a file name's extension gives, application/octet-stream when none is known. */
export const mediaTypeOf = (name: string) => {
	const ext = name.toLowerCase().split(".").pop() ?? "";
	return MEDIA[ext] ?? "application/octet-stream";
};

/**
 * The manifest's entries by path: a torn or foreign line is skipped, not an error, since the
 * MCP client appends lines without a lock and a half-written line is the worst it leaves.
 */
export const parseManifest = (text: string) => {
	const entries = new Map<string, ManifestEntry>();
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let json: unknown;
		try {
			json = JSON.parse(line);
		} catch {
			continue;
		}
		const parsed = ManifestEntrySchema.safeParse(json);
		if (parsed.success) entries.set(parsed.data.path, parsed.data);
	}
	return entries;
};

/** The folder's files joined with the manifest, newest first; the manifest itself is no asset. */
export const assetRows = (
	files: readonly AssetFile[],
	manifest: ReadonlyMap<string, ManifestEntry>,
): AssetRow[] =>
	files
		.filter((f) => f.name !== "manifest.jsonl")
		.map((f): AssetRow => {
			const path = `.mete/assets/${f.name}`;
			const entry = manifest.get(path);
			const mediaType = entry?.mediaType ?? mediaTypeOf(f.name);
			const at =
				entry?.at ??
				(f.mtime === undefined ? undefined : new Date(f.mtime).toISOString());
			return {
				path,
				name: f.name,
				mediaType,
				bytes: entry?.bytes ?? f.bytes,
				image: mediaType.startsWith("image/"),
				...(at === undefined ? {} : { at }),
				...(entry === undefined
					? {}
					: { origin: { server: entry.server, tool: entry.tool } }),
			};
		})
		.sort(
			(a, b) =>
				(b.at ?? "").localeCompare(a.at ?? "") || a.name.localeCompare(b.name),
		);

/** A byte count in the view's words: whole bytes, one decimal for kilobytes and megabytes. */
export const sizeText = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
