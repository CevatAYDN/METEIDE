import { describe, expect, it } from "vitest";
import { artifactLine, artifactSchema } from "../../src/domain/artifacts.js";

const report = () => ({
	title: "Free model providers",
	summary: "Three providers offer free chat models.",
	findings: [
		{ claim: "OpenRouter lists free models.", sourceIds: ["s1"] },
		{ claim: "NVIDIA hosts free endpoints.", sourceIds: ["s1", "s2"] },
	],
	sources: [
		{ id: "s1", url: "https://openrouter.ai/models", title: "Models" },
		{ id: "s2", url: "https://build.nvidia.com", title: "NVIDIA" },
	],
});

const issues = (value: unknown) => {
	const r = artifactSchema("research-report@1")?.safeParse(value);
	return r?.success ? [] : (r?.error.issues.map((i) => i.message) ?? ["none"]);
};

describe("research-report@1", () => {
	it("accepts a report whose every claim cites a listed source", () => {
		expect(issues(report())).toEqual([]);
	});

	it("rejects a claim without a source, or citing one that is not listed", () => {
		const r = report();
		r.findings[0] = { claim: "Uncited.", sourceIds: [] };
		r.findings[1] = { claim: "Wrong.", sourceIds: ["s9"] };
		expect(issues(r)).toHaveLength(2);
		expect(issues(r)[1]).toBe("source s9 is not listed");
	});

	it("rejects a duplicate source id and a non-web url", () => {
		const r = report();
		r.sources.push({ id: "s1", url: "file:///etc/passwd", title: "x" });
		expect(issues(r)).toHaveLength(2);
	});

	it("rejects an unknown key", () => {
		expect(issues({ ...report(), notes: "x" })).toHaveLength(1);
	});
});

describe("artifactSchema", () => {
	it("knows no schema for a type that is not defined yet", () => {
		expect(artifactSchema("asset@1")).toBeUndefined();
	});
});

// A team run's summary is its last artifact's one line, not its JSON (ADR-172).
describe("artifactLine", () => {
	const check = (name: string, passed: boolean) => ({
		name,
		passed,
		details: "ran it",
	});

	it("gives a report's summary, a design's title and a test report's counts", () => {
		expect(artifactLine("research-report@1", report())).toBe(
			"Three providers offer free chat models.",
		);
		expect(
			artifactLine("code-change@1", {
				summary: "Adds a page.",
				files: ["a.html"],
			}),
		).toBe("Adds a page.");
		expect(
			artifactLine("gdd@1", {
				title: "Space Dash",
				pitch: "Dodge rocks.",
				mechanics: ["Move."],
				scope: "One level.",
				acceptance: ["It runs."],
			}),
		).toBe("Space Dash");
		const tests = {
			passed: false,
			checks: [
				check("build", true),
				check("click", false),
				check("load", true),
			],
			gaps: [],
		};
		expect(artifactLine("test-report@1", tests)).toBe("2 of 3 checks passed");
		expect(
			artifactLine("test-report@1", {
				...tests,
				gaps: ["no phone", "no audio"],
			}),
		).toBe("2 of 3 checks passed; 2 gaps");
	});

	it("gives nothing for a value that misses its schema, or a type without a line", () => {
		expect(artifactLine("research-report@1", { title: "x" })).toBeUndefined();
		expect(
			artifactLine("asset-spec@1", {
				assets: [{ name: "a", description: "b", path: "c.png" }],
			}),
		).toBeUndefined();
		expect(artifactLine("asset@1", {})).toBeUndefined();
	});
});
