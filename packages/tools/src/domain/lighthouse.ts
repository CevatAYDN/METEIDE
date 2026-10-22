import { err, ok, type Result, type SeoAuditOutput } from "@mete/contracts";
import { z } from "zod";

// A Lighthouse report (LHR) as seo.audit@2 output (docs/10, Built-in tools): scores 0-1 become
// 0-100, an unscored audit keeps null, and an unscored category fails the call [D]. Pure.

const score = z.number().min(0).max(1).nullable();

/** The part of a Lighthouse report seo.audit@2 reads; the runner's answer is parsed with it. */
export const LhrSchema = z.object({
	categories: z.object({
		performance: z.object({ score }),
		accessibility: z.object({ score }),
		"best-practices": z.object({ score }),
		seo: z.object({ score }),
	}),
	audits: z.record(
		z.string(),
		z.object({
			id: z.string(),
			title: z.string(),
			score,
			displayValue: z.string().optional(),
		}),
	),
});
export type Lhr = z.output<typeof LhrSchema>;

const CATEGORIES = [
	"performance",
	"accessibility",
	"best-practices",
	"seo",
] as const;

const percent = (s: number) => Math.round(s * 100);

/** The scores and audits of a report, or the category Lighthouse left unscored. */
export const auditOutput = (
	lhr: Lhr,
): Result<Omit<SeoAuditOutput, "reportPath">, string> => {
	const unscored = CATEGORIES.find((id) => lhr.categories[id].score === null);
	if (unscored) return err(`Lighthouse did not score the ${unscored} category`);
	// Every category has a score now; ?? 0 only satisfies the type.
	const of = (id: (typeof CATEGORIES)[number]) =>
		percent(lhr.categories[id].score ?? 0);
	const scores = {
		performance: of("performance"),
		accessibility: of("accessibility"),
		bestPractices: of("best-practices"),
		seo: of("seo"),
	};
	const audits = Object.values(lhr.audits).map((a) => ({
		id: a.id,
		title: a.title,
		score: a.score === null ? null : percent(a.score),
		...(a.displayValue ? { details: a.displayValue } : {}),
	}));
	return ok({ scores, audits });
};
