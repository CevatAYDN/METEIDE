import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { isInside } from "../domain/paths.js";
import { mimeOf, staticPath } from "../domain/static-files.js";

// A file server for one folder, on 127.0.0.1 at a port the system picks, for the browser runner:
// it lets Chromium and Lighthouse open a built site without any address coming from the caller
// (docs/10, Built-in tools). Read only, no listings, nothing outside the folder.

/** A running server: the origin to open and how to stop it. */
export type Site = {
	readonly origin: string;
	readonly close: () => Promise<void>;
};

const refuse = (res: ServerResponse, status: number) => {
	res.writeHead(status, { "content-type": "text/plain" });
	res.end(status === 404 ? "not found" : "not allowed");
};

// The file to send: a folder means its index.html; a link out of the folder is not followed.
const fileFor = async (root: string, requestPath: string) => {
	const named = staticPath(root, requestPath);
	if (!named) return undefined;
	try {
		const file = (await stat(named)).isDirectory()
			? join(named, "index.html")
			: named;
		const real = await realpath(file);
		return isInside(root, real) && (await stat(real)).isFile()
			? real
			: undefined;
	} catch {
		return undefined;
	}
};

/** Serves `root` until closed; `root` must exist. */
export const serveFolder = async (root: string): Promise<Site> => {
	const base = await realpath(root);
	const server = createServer((req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") return refuse(res, 405);
		void fileFor(base, req.url ?? "/").then((file) => {
			if (!file) return refuse(res, 404);
			res.writeHead(200, {
				"content-type": mimeOf(file),
				"cache-control": "no-store",
			});
			if (req.method === "HEAD") return res.end();
			createReadStream(file)
				.on("error", () => res.destroy())
				.pipe(res);
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		origin: `http://127.0.0.1:${port}`,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
};
