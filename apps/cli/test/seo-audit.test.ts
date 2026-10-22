import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ChatChunk, SeoAuditReportSchema } from "@mete/contracts";
import type { BrowserOptions } from "@mete/tools";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/application/commands.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// The Phase 3 gate on fakes (ROADMAP.md): the built-in seo-audit template turns a URL into a ranked
// seo-audit@1 through every real module; the models, the browser, Tavily and the page are fakes.

const PAGE = "https://shop.example/";
const RIVAL = "https://rival.example/";

// A small Lighthouse report; the audit ids are what the fixes must cite.
const LHR = {
	categories: {
		performance: { score: 0.72 },
		accessibility: { score: 0.9 },
		"best-practices": { score: 1 },
		seo: { score: 0.64 },
	},
	audits: {
		"meta-description": {
			id: "meta-description",
			title: "Has a meta description",
			score: 0,
		},
		"image-alt": { id: "image-alt", title: "Images have alt text", score: 0.5 },
		"is-crawlable": {
			id: "is-crawlable",
			title: "Page is crawlable",
			score: 1,
		},
	},
};
const PNG = Buffer.from(
	"89504e470d0a1a0a0000000d4948445200000500000002d0",
	"hex",
);

const REPORT = JSON.stringify({
	url: PAGE,
	summary:
		"The page is crawlable but lacks a meta description and image alt text.",
	scores: { performance: 72, accessibility: 90, bestPractices: 100, seo: 64 },
	fixes: [
		{
			priority: "high",
			title: "Add a meta description",
			why: "Search results show it",
			how: "Write one sentence per page",
			auditIds: ["meta-description"],
		},
		{
			priority: "medium",
			title: "Describe every image",
			why: "Screen readers and image search read alt text",
			how: "Add alt to each img",
			auditIds: ["image-alt"],
		},
	],
});

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const say = (text: string): ChatChunk[] => [
	{ type: "text", text },
	finish("stop"),
];
const call = (name: string, args: unknown): ChatChunk[] => [
	{ type: "tool-call", id: `c-${name}`, name, args },
	finish("tool-calls"),
];

// Tavily's search and two pages; anything else, the built-in Exa server among them, is a 404.
const web: typeof fetch = async (input, init) => {
	const url = String(input);
	if (url === "https://api.tavily.com/search" && init?.method === "POST")
		return Response.json({
			results: [{ title: "Rival shop", url: RIVAL, content: "A shop" }],
		});
	if (url === PAGE || url === RIVAL)
		return new Response(
			"<html><head><title>Shop</title></head><body><article><h1>Shop</h1><p>Hand-made goods for every home and garden.</p></article></body></html>",
			{ headers: { "content-type": "text/html" } },
		);
	return new Response("", { status: 404 });
};

const browser: Pick<BrowserOptions, "run" | "chromium"> = {
	run: async (req) => {
		await writeFile(
			req.out,
			req.kind === "screenshot" ? PNG : JSON.stringify(LHR),
		);
		return { ok: true, value: undefined };
	},
	chromium: {
		installed: () => true,
		install: async () => ({ ok: true, value: undefined }),
	},
};

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

describe("the seo-audit template", () => {
	it("turns a URL into a ranked audit whose every fix cites a Lighthouse audit", async () => {
		const repo = await tempRepo({ "README.md": "# shop\n" });
		const script = [
			call("seo_audit", { url: PAGE }),
			call("browser_screenshot", { url: PAGE }),
			say(
				"Scores: performance 72, accessibility 90, bestPractices 100, seo 64. Failing: meta-description, image-alt.",
			),
			call("web_fetch", { url: PAGE }),
			say("The page has a title and one heading but no meta description."),
			call("web_search", { query: "hand-made goods shop" }),
			say(`A rival (${RIVAL}) describes every product.`),
			say(REPORT),
		];
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets({ "search/tavily/apiKey": "tvly-test" }),
			providers: [scriptedProvider({ script })],
			fetch: web,
			browser,
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const t = recordingIo();
		expect(
			await runCommand(app.value, t.io, {
				goal: PAGE,
				templateId: "seo-audit",
			}),
		).toBe(0);
		const runId = /^run (\S+) started$/.exec(t.out[0] ?? "")?.[1] ?? "";
		const file = join(
			repo.workspaceDir,
			".mete",
			"artifacts",
			runId,
			"report.json",
		);
		const report = SeoAuditReportSchema.parse(
			JSON.parse(await readFile(file, "utf8")),
		);
		const ids = Object.keys(LHR.audits);
		expect(
			report.fixes.flatMap((f) => f.auditIds).every((id) => ids.includes(id)),
		).toBe(true);
		expect(t.out).toEqual(
			expect.arrayContaining([
				"tool  seo.audit@1",
				"tool  browser.screenshot@1",
				"tool  web.fetch@1",
				`completed\n${REPORT}`,
			]),
		);
		// The built-in Exa server answers 404 here, so the search falls back to Tavily.
		expect(t.out.filter((l) => l === "tool  web.search@1")).toHaveLength(2);
	});
});
