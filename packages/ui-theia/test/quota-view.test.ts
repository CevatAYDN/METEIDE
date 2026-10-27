import type { QuotaUsage } from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type QuotaModel, QuotaView } from "../src/application/quota-view.js";

// The Quota dashboard rendered to HTML on Node.

const html = (model: QuotaModel, opened: readonly string[] = []) =>
	renderToStaticMarkup(
		createElement(QuotaView, { model, onRefresh: () => {}, opened }),
	);

const unit = (over: Partial<QuotaUsage> = {}): QuotaUsage => ({
	providerId: "openrouter",
	unit: "requests_per_day",
	scope: null,
	used: 3,
	limit: 50,
	resetsAt: "2026-10-24T00:00:00.000Z",
	history: [],
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
		expect(out.match(/<tr[ >]/g)).toHaveLength(3);
		expect(out).toContain('<th scope="col"');
		// A provider's name stands once over its units.
		expect(out).toMatch(/<th scope="rowgroup"[^>]*>openrouter<\/th>/);
		expect(out).toContain(">50</td>");
		expect(out).toContain(">gpt-oss-20b</td>");
		expect(out).toContain(">Not known yet</td>");
		// The used amount has a bar of its share of the limit (3 of 50), and none without a limit.
		expect(out.match(/class="mete-quota-meter"/g)).toHaveLength(1);
		expect(out).toContain('style="width:6%"');
	});

	it("groups a provider's units under its name, one header spanning them", () => {
		const out = html({
			kind: "units",
			units: [
				unit({ providerId: "groq", unit: "requests_per_minute" }),
				unit({ providerId: "openrouter" }),
				unit({ providerId: "groq", unit: "tokens_per_minute", scope: "m" }),
			],
		});
		expect(out.match(/<th scope="rowgroup"/g)).toHaveLength(2);
		expect(out).toMatch(/<th scope="rowgroup" rowSpan="2"[^>]*>groq<\/th>/i);
	});

	it("folds each unit's amounts under their count, oldest first (ADR-055)", () => {
		const history = [
			{ at: "2026-10-23T09:00:00.000Z", amount: 1 },
			{ at: "2026-10-23T09:00:00.000Z", amount: 2 },
		];
		const model: QuotaModel = { kind: "units", units: [unit({ history })] };
		const shut = html(model);
		expect(shut).toMatch(
			/aria-expanded="false"[^>]*>(?:<span[^>]*><\/span>)2 amount\(s\)</,
		);
		expect(shut).not.toContain("<li>");
		const open = html(model, ["openrouter/requests_per_day/"]);
		expect(open).toContain('aria-expanded="true"');
		expect(open.match(/<li>/g)).toHaveLength(2);
		expect(open.indexOf("<span>1</span>")).toBeLessThan(
			open.indexOf("<span>2</span>"),
		);
		expect(open.indexOf("<span>1</span>")).toBeGreaterThan(0);
	});

	it("names the spending cap, and a unit without model, reset or history with a dash", () => {
		const { resetsAt: _, ...cap } = unit({
			providerId: "*",
			unit: "usd_per_day",
		});
		const out = html({ kind: "units", units: [cap] });
		expect(out).toContain(">Every paid model</th>");
		expect(out.match(/>—<\/td>/g)).toHaveLength(3);
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
