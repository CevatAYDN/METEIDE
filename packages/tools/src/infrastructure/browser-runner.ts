// The browser runner: a child process that takes one request, drives Chromium through Playwright
// (and Lighthouse for an audit), writes its file and answers once (docs/10, Built-in tools).
// Run with fork(); a crash here never reaches the main process.
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import lighthouse from "lighthouse";
import { chromium } from "playwright-core";
import { egressProxy } from "./egress-proxy.js";
import { lookupAll } from "./lookup.js";
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
	await opened(req.target, async (url) => {
		const proxy = await egressProxy(
			lookupAll,
			"folder" in req.target ? new URL(url).origin : undefined,
		);
		const browser = await chromium.launch({
			proxy: { server: proxy.url, bypass: "<-loopback>" },
		});
		try {
			const page = await browser.newPage();
			await page.goto(url, { waitUntil: "load" });
			await page.screenshot({ path: req.out, fullPage: req.fullPage });
		} finally {
			await browser.close();
			await proxy.close();
		}
	});
};

const audit = async (req: Extract<RunnerRequest, { kind: "audit" }>) => {
	const port = await freePort();
	await opened(req.target, async (url) => {
		const proxy = await egressProxy(
			lookupAll,
			"folder" in req.target ? new URL(url).origin : undefined,
		);
		const browser = await chromium.launch({
			args: [`--remote-debugging-port=${port}`],
			proxy: { server: proxy.url, bypass: "<-loopback>" },
		});
		try {
			// No telemetry: Lighthouse starts its error reporting only from its CLI, never through this API.
			const result = await lighthouse(url, {
				port,
				output: "json",
				logLevel: "error",
				onlyCategories: CATEGORIES,
			});
			if (!result) throw new Error("Lighthouse returned no result");
			const report = result.report;
			await writeFile(
				req.out,
				Array.isArray(report) ? (report[0] ?? "") : report,
			);
		} finally {
			await browser.close();
			await proxy.close();
		}
	});
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
