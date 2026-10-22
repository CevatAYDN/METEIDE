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

	it("takes the first fenced block of a reply that talks around it, and nothing else", () => {
		const talk = `İşte rapor:\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\nUmarım yardımcı olur.`;
		expect(checkReport("research-report@1", talk)).toEqual({
			ok: true,
			report: JSON.stringify(report),
		});
		const plain = `Here it is:\n\`\`\`\n${JSON.stringify(report)}\n\`\`\``;
		expect(checkReport("research-report@1", plain).ok).toBe(true);
		// A reply that is JSON stays JSON, even when a string inside it holds a fence.
		const inner = { ...report, summary: "see ```json\n{}\n``` above" };
		expect(checkReport("research-report@1", JSON.stringify(inner))).toEqual({
			ok: true,
			report: JSON.stringify(inner),
		});
		// No repair of the value itself: a trailing comma is still a failure for the repair message.
		const comma = `\`\`\`json\n{"title":"T",}\n\`\`\``;
		expect(checkReport("research-report@1", comma)).toEqual({
			ok: false,
			issues: "the reply is not JSON",
		});
		expect(checkReport("research-report@1", "no fence, no JSON").ok).toBe(
			false,
		);
	});

	it("names what is wrong for the repair message", () => {
		const r = checkReport("research-report@1", '{"title":"T"}');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.issues).toContain("summary");
		const notJson = checkReport("research-report@1", "here you go");
		expect(notJson.ok ? "" : notJson.issues).toContain("not JSON");
	});
});
