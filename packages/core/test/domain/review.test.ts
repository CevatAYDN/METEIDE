import { describe, expect, it } from "vitest";
import { checkVerdict } from "../../src/domain/review.js";

// A reviewer writes its findings before its verdict (ADR-134), so the verdict is read from the
// reply's last fenced block when the whole reply is no JSON.

const TICKS = "```";
const fence = (lang: string, body: string) =>
	[`${TICKS}${lang}`, body, TICKS].join("\n");

describe("a reviewer's verdict", () => {
	it("takes a bare JSON verdict as before", () => {
		expect(checkVerdict('{"decision":"approve"}')).toEqual({
			ok: true,
			verdict: { decision: "approve" },
		});
	});

	it("takes the verdict after the findings, past a quoted code block (ADR-134)", () => {
		const reply = [
			"Findings:",
			'- "Kaliteli kahveyle günüzü keyifli başlatın." wrong: "gününüzü"',
			fence("html", "<p>günüzü</p>"),
			fence(
				"json",
				'{"decision":"revise","feedback":"Write gününüzü, not günüzü."}',
			),
		].join("\n");
		expect(checkVerdict(reply)).toEqual({
			ok: true,
			verdict: { decision: "revise", feedback: "Write gününüzü, not günüzü." },
		});
	});

	it("refuses findings with no verdict", () => {
		expect(checkVerdict("Findings: all sentences are right.")).toMatchObject({
			ok: false,
		});
	});
});
