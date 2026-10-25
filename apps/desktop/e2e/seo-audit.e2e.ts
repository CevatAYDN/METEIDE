import { readFileSync } from "node:fs";
import { SeoAuditReportSchema } from "@mete/contracts";
import { artifactPath, expect, runCommand, test } from "./launch.js";

// The Phase 5 gate's template acceptance as a user drives it (ROADMAP.md; docs/15): the SEO audit
// team runs in the desktop app and leaves a ranked seo-audit@1. The models, the web pages, the
// screenshot and the Lighthouse report come from the test's scripts (ADR-111, ADR-116, ADR-117), so
// the app needs no provider key, starts no Chromium and reaches no network, while the daemon, the
// engine, the three tools and the panels stay the real ones.

const PAGE = "https://shop.example/";
const RIVAL = "https://rival.example/";
const HTML =
	"<html><head><title>Shop</title></head><body><article><h1>Hand-made goods</h1><p>Hand-made goods for every home and garden.</p></article></body></html>";

// The audit ids are what the lead's fixes must cite, as the template asks (docs/08).
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
	},
};

const REPORT = JSON.stringify({
	url: PAGE,
	summary: "The page lacks a meta description and image alt text.",
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
			why: "Screen readers read alt text",
			how: "Add alt to each img",
			auditIds: ["image-alt"],
		},
	],
});

const finish = (reason: "stop" | "tool-calls") => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const say = (text: string) => [{ type: "text", text }, finish("stop")];
const call = (name: string, args: unknown) => [
	{ type: "tool-call", id: `c-${name}`, name, args },
	finish("tool-calls"),
];

test.use({
	web: {
		results: [{ title: "Rival shop", url: RIVAL, snippet: "A shop" }],
		pages: { [PAGE]: HTML, [RIVAL]: HTML },
	},
	browserScript: {
		screenshots: [{ width: 1280, height: 720 }],
		audits: [LHR],
	},
	// The calls of the built-in seo-audit team, in the order the engine makes them (docs/08).
	script: {
		turns: [
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
		],
	},
});

test("the SEO audit team turns a URL into a ranked audit", async ({ mete }) => {
	const { page, dir } = mete;
	await runCommand(page, "METE: Start run");
	await page.getByLabel("What should METE do in this folder?").fill(PAGE);
	await page.getByRole("radio", { name: /SEO audit/ }).check();
	await page.getByRole("button", { name: "Start run", exact: true }).click();

	await expect
		.poll(() => artifactPath(dir, "report.json"), { timeout: 180_000 })
		.toBeDefined();
	const report = SeoAuditReportSchema.parse(
		JSON.parse(readFileSync(artifactPath(dir, "report.json") ?? "", "utf8")),
	);
	expect(report.url).toBe(PAGE);
	expect(report.scores).toEqual({
		performance: 72,
		accessibility: 90,
		bestPractices: 100,
		seo: 64,
	});
	// Every fix cites an audit of the report the scripted browser wrote.
	const ids = Object.keys(LHR.audits);
	expect(
		report.fixes.flatMap((f) => f.auditIds).every((id) => ids.includes(id)),
	).toBe(true);

	// The run ends without an approval: the Team panel's strip says Done (docs/13).
	await expect(
		page.locator(".mete-chip").filter({ hasText: "Done" }).first(),
	).toBeVisible({ timeout: 120_000 });
});
