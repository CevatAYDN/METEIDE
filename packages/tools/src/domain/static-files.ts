import { extname, resolve } from "node:path";
import { isInside } from "./paths.js";

// What the browser runner's file server answers (docs/10, Built-in tools): the file a request path
// names inside one folder, and its media type. Pure.

const TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json",
	".map": "application/json",
	".webmanifest": "application/manifest+json",
	".xml": "application/xml",
	".txt": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
};

/** The media type of a file by its extension. */
export const mimeOf = (file: string) =>
	TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";

/**
 * The path a request names inside `root`, or undefined when it is malformed or climbs out of it
 * (`..`, an encoded `..`, a backslash on Windows, a null byte). The query and fragment are ignored.
 */
export const staticPath = (root: string, requestPath: string) => {
	let decoded: string;
	try {
		decoded = decodeURIComponent(requestPath.split(/[?#]/)[0] ?? "");
	} catch {
		return undefined;
	}
	if (decoded.includes("\0")) return undefined;
	const target = resolve(
		root,
		`.${decoded.startsWith("/") ? "" : "/"}${decoded}`,
	);
	return isInside(root, target) ? target : undefined;
};
