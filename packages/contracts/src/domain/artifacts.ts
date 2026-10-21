import { z } from "zod";

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

// shortcut: only research-report@1 is defined; the other docs/08 types come with their templates.
const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
	"research-report@1": ResearchReportSchema,
};

/** The schema of an artifact type such as `research-report@1`, when one is defined. */
export const artifactSchema = (type: string): z.ZodType | undefined =>
	SCHEMAS[type];
