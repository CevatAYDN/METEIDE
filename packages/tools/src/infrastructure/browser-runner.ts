// The browser runner: a child process that takes one request, drives Chromium through Playwright
// (and Lighthouse for an audit), writes its file and answers once (docs/10, Built-in tools).
// Run with fork(); a crash here never reaches the main process.
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import lighthouse from "lighthouse";
import { chromium } from "playwright-core";
import { isPublicHost } from "../domain/addresses.js";
import type { RunnerReply, RunnerRequest, Target } from "./runner.js";
import { serveFolder } from "./static-server.js";

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});

// Opens the target: a public page as it is, a built folder through a file server that lives while the job runs.
const opened = async <T>(target: Target, work: (url: string) => Promise<T>) => {
	if ("url" in target) return work(target.url);
	const site = await serveFolder(target.folder);
	try {
		return await work(`${site.origin}/`);
	} finally {
		await site.close();
	}
};

const screenshot = async (
	req: Extract<RunnerRequest, { kind: "screenshot" }>,
) => {
	const browser = await chromium.launch();
	try {
		await opened(req.target, async (url) => {
			const page = await browser.newPage();
			// Every request the page makes must go to a public address, like web.fetch@1's hops, or to
			// the file server of the folder being shown, which serves that folder and nothing else.
			const own = "folder" in req.target ? new URL(url).origin : undefined;
			await page.route("**/*", (route) => {
				const { hostname, origin } = new URL(route.request().url());
				return isPublicHost(hostname) || origin === own
					? route.continue()
					: route.abort("blockedbyclient");
			});
			await page.goto(url, { waitUntil: "load" });
			await page.screenshot({ path: req.out, fullPage: req.fullPage });
		});
	} finally {
		await browser.close();
	}
};

const audit = async (req: Extract<RunnerRequest, { kind: "audit" }>) => {
	const port = await freePort();
	const browser = await chromium.launch({
		args: [`--remote-debugging-port=${port}`],
	});
	try {
		// shortcut: only the page's own address is checked; Lighthouse loads its subresources itself.
		// No telemetry: Lighthouse starts its error reporting only from its own CLI, never through this API.
		const result = await opened(req.target, (url) =>
			lighthouse(url, {
				port,
				output: "json",
				logLevel: "error",
				onlyCategories: CATEGORIES,
			}),
		);
		if (!result) throw new Error("Lighthouse returned no result");
		const report = result.report;
		await writeFile(
			req.out,
			Array.isArray(report) ? (report[0] ?? "") : report,
		);
	} finally {
		await browser.close();
	}
};

const handle = async (req: RunnerRequest): Promise<RunnerReply> => {
	try {
		await (req.kind === "screenshot" ? screenshot(req) : audit(req));
		return { ok: true };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
};

process.once("message", (req: RunnerRequest) => {
	void handle(req).then((reply) =>
		process.send?.(reply, () => process.exit(0)),
	);
});
