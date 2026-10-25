import { readFileSync } from "node:fs";
import { ResearchReportSchema } from "@mete/contracts";
import { artifactPath, expect, runCommand, test } from "./launch.js";

// The Phase 5 gate's template acceptance as a user drives it (ROADMAP.md; docs/15): the research team
// runs in the desktop app and leaves a cited research-report@1. The models and the web answers come
// from the test's scripts (ADR-111, ADR-116), so the app needs no provider key and reaches no network,
// while the daemon, the engine, the tools and the panels stay the real ones.

const PAGE = "https://example.org/free-models";
const HTML =
	"<html><head><title>Free models</title></head><body><article><p>OpenRouter lists free models, and NVIDIA hosts free endpoints for everyone.</p></article></body></html>";
const REPORT = JSON.stringify({
	title: "Free model providers",
	summary: "OpenRouter and NVIDIA offer free chat models.",
	findings: [
		{ claim: "OpenRouter lists free models.", sourceIds: ["s1"] },
		{ claim: "NVIDIA hosts free endpoints.", sourceIds: ["s1"] },
	],
	sources: [{ id: "s1", url: PAGE, title: "Free models" }],
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

/** The report the run wrote, once the synthesizer's task is approved. */
const reportPath = (dir: string): string | undefined =>
	artifactPath(dir, "report.json");

test.use({
	web: {
		results: [{ title: "Free models", url: PAGE, snippet: "A list" }],
		pages: { [PAGE]: HTML },
	},
	// The calls of the built-in research team, in the order the engine makes them (docs/08).
	script: {
		turns: [
			call("web_search", { query: "free model providers" }),
			call("web_fetch", { url: PAGE }),
			say(`Notes: OpenRouter lists free models (${PAGE}).`),
			say(`Notes: NVIDIA hosts free endpoints (${PAGE}).`),
			say(REPORT),
			say('{"decision":"approve"}'),
		],
	},
});

test("the research team turns a goal into a cited report", async ({ mete }) => {
	const { page, dir } = mete;
	await runCommand(page, "METE: Start run");
	await page
		.getByLabel("What should METE do in this folder?")
		.fill("free model providers");
	await page.getByRole("radio", { name: /Research/ }).check();
	await page.getByRole("button", { name: "Start run", exact: true }).click();

	await expect.poll(() => reportPath(dir), { timeout: 180_000 }).toBeDefined();
	const report = ResearchReportSchema.parse(
		JSON.parse(readFileSync(reportPath(dir) ?? "", "utf8")),
	);
	expect(report.sources[0]?.url).toBe(PAGE);
	expect(report.findings.length).toBeGreaterThan(0);

	// The run ends after the lead's approval: the Team panel's strip says Done (docs/13).
	await expect(
		page.locator(".mete-chip").filter({ hasText: "Done" }).first(),
	).toBeVisible({ timeout: 120_000 });
});
