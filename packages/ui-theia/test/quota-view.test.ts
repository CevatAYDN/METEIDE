import type { QuotaUnitUsage } from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type QuotaModel, QuotaView } from "../src/application/quota-view.js";

// The Quota dashboard rendered to HTML on Node.

const html = (model: QuotaModel) =>
	renderToStaticMarkup(
		createElement(QuotaView, { model, onRefresh: () => {} }),
	);

const unit = (over: Partial<QuotaUnitUsage> = {}): QuotaUnitUsage => ({
	providerId: "openrouter",
	unit: "requests_per_day",
	scope: null,
	used: 3,
	limit: 50,
	resetsAt: "2026-10-24T00:00:00.000Z",
	...over,
});

describe("the Quota dashboard", () => {
	it("lists each unit's provider, model, usage, limit and reset", () => {
		const out = html({
			kind: "units",
			units: [
				unit(),
				unit({
					providerId: "groq",
					unit: "requests_per_minute",
					scope: "gpt-oss-20b",
					limit: null,
				}),
			],
		});
		expect(out.match(/<tr>/g)).toHaveLength(3);
		expect(out).toContain('<th scope="col"');
		expect(out).toContain(">openrouter</td>");
		expect(out).toContain(">50</td>");
		expect(out).toContain(">gpt-oss-20b</td>");
		expect(out).toContain(">Not known yet</td>");
	});

	it("names the spending cap, and a unit without model or reset with a dash", () => {
		const { resetsAt: _, ...cap } = unit({
			providerId: "*",
			unit: "usd_per_day",
		});
		const out = html({ kind: "units", units: [cap] });
		expect(out).toContain(">Every paid model</td>");
		expect(out.match(/>—<\/td>/g)).toHaveLength(2);
	});

	it("says there are no units yet, a folder is needed, or why the daemon gave none", () => {
		expect(html({ kind: "units", units: [] })).toContain("No quota units yet");
		expect(html({ kind: "no_folder" })).toContain("Open a folder first");
		expect(
			html({
				kind: "failed",
				failure: { code: "stopped", detail: "exit code 1" },
			}),
		).toContain('role="alert"');
	});
});
