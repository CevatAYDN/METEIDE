import { describe, expect, it } from "vitest";
import { checkReport } from "../../src/domain/guardrail.js";

const report = {
	title: "T",
	summary: "S",
	findings: [{ claim: "C", sourceIds: ["s1"] }],
	sources: [{ id: "s1", url: "https://example.com", title: "E" }],
};

describe("checkReport", () => {
	it("passes any reply when the task has no guardrail", () => {
		expect(checkReport(undefined, "plain text")).toEqual({
			ok: true,
			report: "plain text",
		});
	});

	it("takes the JSON out of a fenced reply and keeps it as compact JSON", () => {
		const fenced = `\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``;
		expect(checkReport("research-report@1", fenced)).toEqual({
			ok: true,
			report: JSON.stringify(report),
		});
	});

	it("names what is wrong for the repair message", () => {
		const r = checkReport("research-report@1", '{"title":"T"}');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.issues).toContain("summary");
		const notJson = checkReport("research-report@1", "here you go");
		expect(notJson.ok ? "" : notJson.issues).toContain("not JSON");
	});
});
