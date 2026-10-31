import { z } from "zod";
import { SeoScoresSchema } from "./browser.js";
import {
	AssetSpecSchema,
	CodeChangeSchema,
	GddSchema,
	TaskListSchema,
	TestReportSchema,
} from "./game-studio.js";
import { LessonSchema } from "./vault.js";

// Artifact type schemas from docs/08 (Built-in templates); a guardrail validates output against them.

const text = z.string().min(1);

const SourceSchema = z.strictObject({
	id: text,
	url: z.url({ protocol: /^https?$/ }),
	title: text,
});

/** research-report@1: every finding cites at least one listed source. */
export const ResearchReportSchema = z
	.strictObject({
		title: text,
		summary: text,
		findings: z
			.array(
				z.strictObject({
					claim: text,
					sourceIds: z.array(text).min(1).readonly(),
				}),
			)
			.min(1)
			.readonly(),
		sources: z.array(SourceSchema).min(1).readonly(),
	})
	.superRefine((r, ctx) => {
		const ids = r.sources.map((s) => s.id);
		ids.forEach((id, i) => {
			if (ids.indexOf(id) !== i)
				ctx.addIssue({
					code: "custom",
					path: ["sources", i, "id"],
					message: `source ${id} is listed twice`,
				});
		});
		r.findings.forEach((f, i) => {
			for (const id of f.sourceIds)
				if (!ids.includes(id))
					ctx.addIssue({
						code: "custom",
						path: ["findings", i, "sourceIds"],
						message: `source ${id} is not listed`,
					});
		});
	});

/** A validated research report. */
export type ResearchReport = z.output<typeof ResearchReportSchema>;

/** seo-audit@1: a page's scores and its ranked fixes; every fix names the audits behind it. */
export const SeoAuditReportSchema = z.strictObject({
	url: z.url({ protocol: /^https?$/ }),
	summary: text,
	scores: SeoScoresSchema,
	fixes: z
		.array(
			z.strictObject({
				priority: z.enum(["high", "medium", "low"]),
				title: text,
				why: text,
				how: text,
				auditIds: z.array(text).min(1).readonly(),
			}),
		)
		.readonly(),
});

/** A validated SEO audit report; the fixes are in rank order, the most important first. */
export type SeoAuditReport = z.output<typeof SeoAuditReportSchema>;

// shortcut: asset@1 has no schema yet: an asset is a file with a manifest line.
const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
	"lesson@1": LessonSchema,
	"research-report@1": ResearchReportSchema,
	"seo-audit@1": SeoAuditReportSchema,
	"gdd@1": GddSchema,
	"task-list@1": TaskListSchema,
	"asset-spec@1": AssetSpecSchema,
	"test-report@1": TestReportSchema,
	"code-change@1": CodeChangeSchema,
};

/** The schema of an artifact type such as `research-report@1`, when one is defined. */
export const artifactSchema = (type: string): z.ZodType | undefined =>
	SCHEMAS[type];

const testLine = (r: z.output<typeof TestReportSchema>) => {
	const passed = r.checks.filter((c) => c.passed).length;
	const g = r.gaps.length;
	const gaps = g === 0 ? "" : `; ${g} ${g === 1 ? "gap" : "gaps"}`;
	return `${passed} of ${r.checks.length} checks passed${gaps}`;
};

// task-list@1 and asset-spec@1 have no text field and end no shipped template.
const LINES: Readonly<Record<string, (value: unknown) => string | undefined>> =
	{
		"research-report@1": (v) => ResearchReportSchema.safeParse(v).data?.summary,
		"seo-audit@1": (v) => SeoAuditReportSchema.safeParse(v).data?.summary,
		"code-change@1": (v) => CodeChangeSchema.safeParse(v).data?.summary,
		"gdd@1": (v) => GddSchema.safeParse(v).data?.title,
		"lesson@1": (v) => LessonSchema.safeParse(v).data?.title,
		"test-report@1": (v) => {
			const r = TestReportSchema.safeParse(v);
			return r.success ? testLine(r.data) : undefined;
		},
	};

/** An artifact's one line, for a team run's summary, when the value meets its type's schema (ADR-172). */
export const artifactLine = (
	type: string,
	value: unknown,
): string | undefined => LINES[type]?.(value);
