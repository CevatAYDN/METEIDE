import { z } from "zod";

// browser.screenshot@2 and seo.audit@2 from docs/10 (Built-in tools); adapters return ToolError
// (tools.ts). A public address asks policy.check@1 with action net.fetch, like web.fetch@1; a
// folder is served to the browser by the tool itself, so no address comes from the caller.

const webUrl = z.url({ protocol: /^https?$/ });
const score = z.number().int().min(0).max(100);
// A built site: a folder with an index.html, relative to the workspace or the task's worktree.
const folder = z.string().min(1);
const fullPage = z.boolean().default(false);

/** Input of browser.screenshot@2: a public page or a built folder; fullPage defaults to the viewport only. */
export const BrowserScreenshotInputSchema = z.union([
	z.strictObject({ url: webUrl, fullPage }),
	z.strictObject({ folder, fullPage }),
]);
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

/** Input of seo.audit@2: a public page or a built folder. */
export const SeoAuditInputSchema = z.union([
	z.strictObject({ url: webUrl }),
	z.strictObject({ folder }),
]);
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
