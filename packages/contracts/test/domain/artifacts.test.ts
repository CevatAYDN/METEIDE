import { describe, expect, it } from "vitest";
import { artifactSchema } from "../../src/domain/artifacts.js";

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
		expect(artifactSchema("lesson@1")).toBeUndefined();
	});
});
