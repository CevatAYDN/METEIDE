import { z } from "zod";

// browser.screenshot@1 and seo.audit@1 from docs/10 (Built-in tools); adapters return ToolError
// (tools.ts) and, like web.fetch@1, ask policy.check@1 with action net.fetch for a public address.

const webUrl = z.url({ protocol: /^https?$/ });
const score = z.number().int().min(0).max(100);

/** Input of browser.screenshot@1: one http or https page; fullPage defaults to the viewport only. */
export const BrowserScreenshotInputSchema = z.strictObject({
	url: webUrl,
	fullPage: z.boolean().default(false),
});
export type BrowserScreenshotInput = z.input<
	typeof BrowserScreenshotInputSchema
>;
/** The image, saved in .mete/assets/ and named by its workspace-relative path, and its size in pixels. */
export type BrowserScreenshotOutput = {
	readonly path: string;
	readonly width: number;
	readonly height: number;
};

/** The four Lighthouse category scores, 0 to 100; seo-audit@1 reuses them. */
export const SeoScoresSchema = z.strictObject({
	performance: score,
	accessibility: score,
	bestPractices: score,
	seo: score,
});
export type SeoScores = z.output<typeof SeoScoresSchema>;

/** Input of seo.audit@1: one http or https page. */
export const SeoAuditInputSchema = z.strictObject({ url: webUrl });
export type SeoAuditInput = z.input<typeof SeoAuditInputSchema>;
/**
 * The audit: category scores, each audit with a 0-100 score or null when Lighthouse does not
 * score it, and the full report saved in .mete/assets/ (reportPath, workspace-relative).
 */
export type SeoAuditOutput = {
	readonly scores: SeoScores;
	readonly audits: readonly {
		readonly id: string;
		readonly title: string;
		readonly score: number | null;
		readonly details?: string;
	}[];
	readonly reportPath: string;
};
