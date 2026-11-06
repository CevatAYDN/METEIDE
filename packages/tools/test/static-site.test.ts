import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mimeOf, staticPath } from "../src/domain/static-files.js";
import { serveFolder } from "../src/infrastructure/static-server.js";

// The file server the browser runner opens a built site through (docs/10, Built-in tools).

describe("staticPath and mimeOf", () => {
	const root = resolve("/site");

	it("names a file inside the folder and ignores the query", () => {
		expect(staticPath(root, "/a/b.css?v=1#x")).toBe(join(root, "a", "b.css"));
		expect(staticPath(root, "/")).toBe(root);
		expect(staticPath(root, "/a%20b.txt")).toBe(join(root, "a b.txt"));
	});

	it("refuses a path that climbs out, however it is spelled", () => {
		for (const p of [
			"/../x",
			"/a/../../x",
			"/%2e%2e/x",
			"/%2E%2E%2fx",
			"/a%00.txt",
			"/%zz",
		])
			expect(staticPath(root, p), p).toBeUndefined();
	});

	it("knows the media types a built site uses and falls back to bytes", () => {
		expect(mimeOf("a/index.HTML")).toBe("text/html; charset=utf-8");
		expect(mimeOf("a.js")).toBe("text/javascript; charset=utf-8");
		expect(mimeOf("a.woff2")).toBe("font/woff2");
		expect(mimeOf("a.unknown")).toBe("application/octet-stream");
	});
});

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const c of cleanup) await c();
	cleanup = [];
});

// Junctions do not need Windows symlink privileges; unsupported fixtures fail, never pass silently.
const directoryLink = (target: string, alias: string) =>
	symlink(target, alias, process.platform === "win32" ? "junction" : "dir");

// A raw GET, so the request path reaches the server as written (fetch would normalise "..").
const get = (origin: string, path: string) =>
	new Promise<{ status: number; type: string; body: string }>(
		(resolve, reject) => {
			const url = new URL(origin);
			const req = request(
				{ host: url.hostname, port: url.port, path, method: "GET" },
				(res) => {
					let body = "";
					res.on("data", (c) => {
						body += c;
					});
					res.on("end", () =>
						resolve({
							status: res.statusCode ?? 0,
							type: String(res.headers["content-type"] ?? ""),
							body,
						}),
					);
				},
			);
			req.on("error", reject);
			req.end();
		},
	);

describe("serveFolder", () => {
	it.each(["workspace", "worktree"])(
		"refuses ignored children and indexes but serves ordinary assets in a %s preview",
		async (scope) => {
			const base = await realpath(
				await mkdtemp(join(tmpdir(), "mete-ignore-site-")),
			);
			const workspaceDir = join(base, "workspace");
			const worktreesDir = join(base, "worktrees");
			const root = join(
				scope === "workspace"
					? workspaceDir
					: join(worktreesDir, "run", "task"),
				"dist",
			);
			await mkdir(workspaceDir, { recursive: true });
			await mkdir(join(root, "nested"), { recursive: true });
			await mkdir(join(root, "assets"));
			await writeFile(
				join(workspaceDir, ".meteignore"),
				"/dist/hidden.txt\n/dist/nested/index.html\n",
			);
			await writeFile(join(root, "index.html"), "<h1>home</h1>");
			await writeFile(join(root, ".env"), "TOKEN=private");
			await writeFile(join(root, "hidden.txt"), "private");
			await writeFile(join(root, "nested", "index.html"), "private");
			await writeFile(join(root, "assets", "app.css"), "h1{color:red}");
			const served = await serveFolder(root, { workspaceDir, worktreesDir });
			try {
				for (const path of [
					"/.env",
					"/hidden.txt",
					"/nested/",
					"/nested/index.html",
				])
					expect((await get(served.origin, path)).status, path).toBe(404);
				expect((await get(served.origin, "/assets/app.css")).status).toBe(200);
				expect((await get(served.origin, "/")).status).toBe(200);
				await directoryLink(join(root, "nested"), join(root, "alias"));
				await directoryLink(join(root, "assets"), join(root, "hidden-link"));
				await writeFile(
					join(workspaceDir, ".meteignore"),
					"/dist/hidden.txt\n/dist/hidden-link/\n/dist/nested/index.html\n",
				);
				expect((await get(served.origin, "/alias/")).status).toBe(404);
				expect((await get(served.origin, "/alias/index.html")).status).toBe(
					404,
				);
				expect((await get(served.origin, "/hidden-link/app.css")).status).toBe(
					404,
				);
				expect((await get(served.origin, "/assets/app.css")).status).toBe(200);
			} finally {
				await served.close();
				await rm(base, { recursive: true, force: true });
			}
		},
	);

	const site = async () => {
		const base = await realpath(await mkdtemp(join(tmpdir(), "mete-site-")));
		const root = join(base, "dist");
		await mkdir(join(root, "assets"), { recursive: true });
		await writeFile(join(root, "index.html"), "<h1>home</h1>");
		await writeFile(join(root, "assets", "app.css"), "h1{color:red}");
		await writeFile(join(base, "secret.txt"), "outside");
		const served = await serveFolder(root);
		cleanup.push(async () => {
			await served.close();
			await rm(base, { recursive: true, force: true });
		});
		return { base, root, ...served };
	};

	it("serves the folder on loopback: its index, its files and their media types", async () => {
		const s = await site();
		expect(s.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(await get(s.origin, "/")).toMatchObject({
			status: 200,
			type: "text/html; charset=utf-8",
			body: "<h1>home</h1>",
		});
		expect(await get(s.origin, "/assets/app.css")).toMatchObject({
			status: 200,
			type: "text/css; charset=utf-8",
			body: "h1{color:red}",
		});
	});

	it("answers 404 for a path out of the folder, a missing file and a folder without an index", async () => {
		const s = await site();
		for (const path of [
			"/../secret.txt",
			"/%2e%2e/secret.txt",
			"/missing.js",
			"/assets/",
		])
			expect((await get(s.origin, path)).status, path).toBe(404);
	});

	it("does not follow a directory link out of the folder", async () => {
		const s = await site();
		const outside = join(s.base, "outside");
		await mkdir(outside);
		await writeFile(join(outside, "secret.txt"), "outside");
		await directoryLink(outside, join(s.root, "link"));
		expect((await get(s.origin, "/link/secret.txt")).status).toBe(404);
	});

	it("takes reads only", async () => {
		const s = await site();
		const status = await new Promise<number>((resolve, reject) => {
			const url = new URL(s.origin);
			const req = request(
				{ host: url.hostname, port: url.port, path: "/", method: "POST" },
				(res) => {
					res.resume();
					resolve(res.statusCode ?? 0);
				},
			);
			req.on("error", reject);
			req.end();
		});
		expect(status).toBe(405);
	});
});
