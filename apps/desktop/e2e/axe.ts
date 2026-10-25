import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

// axe-core inside the end-to-end tests (docs/15). @axe-core/playwright's builder opens a blank tab
// to preload axe, which Electron's default context refuses (Target.createTarget), so the engine is
// injected into the page and run there, scoped to METE's own panels (docs/13's design system).

const REQUIRE = createRequire(`${process.cwd()}/package.json`);
const AXE_SOURCE = readFileSync(
	REQUIRE.resolve("axe-core/axe.min.js"),
	"utf8",
) as string;

type AxeViolation = { readonly id: string; readonly impact?: string };

/** The serious and critical axe violations of every visible METE panel on the page. */
export const meteViolations = async (page: Page) => {
	await page.evaluate(AXE_SOURCE);
	const { violations } = await page.evaluate(() => {
		const panels = [
			...document.querySelectorAll<HTMLElement>(".mete-panel"),
		].filter((p) => p.offsetWidth || p.offsetHeight);
		const scope =
			panels.length > 0 ? (panels as unknown as HTMLElement) : document.body;
		return window.axe.run(scope, {
			runOnly: {
				type: "tag",
				values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
			},
		});
	});
	return (violations as AxeViolation[]).filter(
		(v) => v.impact === "serious" || v.impact === "critical",
	);
};

declare global {
	interface Window {
		axe: {
			run: (
				context: unknown,
				options: {
					readonly runOnly: {
						readonly type: string;
						readonly values: string[];
					};
				},
			) => Promise<{ violations: unknown }>;
		};
	}
}
