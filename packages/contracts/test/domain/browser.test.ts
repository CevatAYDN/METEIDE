import { describe, expect, it } from "vitest";
import { artifactSchema } from "../../src/domain/artifacts.js";
import {
	BrowserScreenshotInputSchema,
	SeoAuditInputSchema,
} from "../../src/domain/browser.js";
import { TOOL_CATALOG, toolName } from "../../src/domain/tool-catalog.js";

const scores = {
	performance: 90,
	accessibility: 100,
	bestPractices: 95,
	seo: 80,
};
const fix = {
	priority: "high",
	title: "Add a meta description",
	why: "Search results show it",
	how: "Add <meta name=description>",
	auditIds: ["meta-description"],
};

describe("browser and seo contracts", () => {
	it("takes public web pages only and defaults fullPage to false", () => {
		expect(
			BrowserScreenshotInputSchema.parse({ url: "https://a.example/" }),
		).toEqual({
			url: "https://a.example/",
			fullPage: false,
		});
		expect(
			SeoAuditInputSchema.safeParse({ url: "file:///etc/hosts" }).success,
		).toBe(false);
	});

	it("checks seo-audit@1: scores 0-100, fixes ranked and backed by an audit", () => {
		const schema = artifactSchema("seo-audit@1");
		const report = {
			url: "https://a.example/",
			summary: "Good",
			scores,
			fixes: [fix],
		};
		expect(schema?.safeParse(report).success).toBe(true);
		for (const bad of [
			{ ...report, fixes: [{ ...fix, auditIds: [] }] },
			{ ...report, fixes: [{ ...fix, priority: "urgent" }] },
			{ ...report, scores: { ...scores, seo: 101 } },
		])
			expect(schema?.safeParse(bad).success).toBe(false);
	});

	it("offers both tools to the model under distinct names", () => {
		const names = TOOL_CATALOG.map((t) => toolName(t.ref));
		expect(names).toEqual(
			expect.arrayContaining(["browser_screenshot", "seo_audit"]),
		);
		expect(new Set(names).size).toBe(names.length);
	});
});
