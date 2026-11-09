import {
	type BrowserScreenshotOutput,
	type CapabilityRef,
	type FsEditOutput,
	type FsGrepOutput,
	type FsPathsOutput,
	type FsReadOutput,
	type FsWriteOutput,
	type KnowledgeHit,
	type KnowledgeSearchOutput,
	MAPPABLE_OUTPUTS,
	NoteTypeSchema,
	type SeoAuditOutput,
	SeoScoresSchema,
	type VaultReadOutput,
	type VaultWriteOutput,
	type VcsGitOutput,
	type WebFetchOutput,
} from "@mete/contracts";
import { z } from "zod";

const paths = z.object({
	paths: z.array(z.string()),
}) satisfies z.ZodType<FsPathsOutput>;

// Only these git operations are executable through TOOL_CATALOG.
const git = z.discriminatedUnion("op", [
	z.object({
		op: z.literal("status"),
		branch: z.string().nullable(),
		files: z.array(
			z.object({
				path: z.string(),
				index: z.string(),
				worktree: z.string(),
			}),
		),
	}),
	z.object({ op: z.literal("diff"), diff: z.string() }),
	z.object({ op: z.literal("commit"), sha: z.string() }),
]) satisfies z.ZodType<
	Extract<VcsGitOutput, { op: "status" | "diff" | "commit" }>
>;

const sources = z
	.object({ keyword: z.number().optional() })
	.transform(({ keyword }): KnowledgeHit["sources"] =>
		keyword === undefined ? {} : { keyword },
	);
const hit = z
	.object({
		path: z.string(),
		scope: z.enum(["workspace", "personal"]),
		type: NoteTypeSchema,
		title: z.string(),
		heading: z.string().optional(),
		snippet: z.string(),
		sources,
	})
	.transform(
		({ heading, ...fields }): KnowledgeHit =>
			heading === undefined ? fields : { ...fields, heading },
	);
const audit = z
	.object({
		id: z.string(),
		title: z.string(),
		score: z.number().min(0).max(100).nullable(),
		details: z.string().optional(),
	})
	.transform(({ details, ...fields }): SeoAuditOutput["audits"][number] =>
		details === undefined ? fields : { ...fields, details },
	);

// These catalog capabilities export output types, but no public output schemas.
const outputs: Readonly<Partial<Record<CapabilityRef, z.ZodType>>> = {
	"fs.read@1": z.object({
		content: z.string(),
		totalLines: z.number(),
		lineEnding: z.enum(["lf", "crlf", "mixed", "none"]),
	}) satisfies z.ZodType<FsReadOutput>,
	"fs.write@1": z.object({
		bytes: z.number(),
	}) satisfies z.ZodType<FsWriteOutput>,
	"fs.edit@1": z.object({
		replacements: z.number(),
	}) satisfies z.ZodType<FsEditOutput>,
	"fs.list@1": paths,
	"fs.glob@1": paths,
	"fs.grep@1": z.object({
		matches: z.array(
			z.object({
				path: z.string(),
				line: z.number(),
				text: z.string(),
			}),
		),
		truncated: z.boolean(),
	}) satisfies z.ZodType<FsGrepOutput>,
	"web.fetch@1": z.object({
		markdown: z.string(),
		title: z.string(),
		finalUrl: z.string(),
	}) satisfies z.ZodType<WebFetchOutput>,
	"vault.read@1": z.object({
		path: z.string(),
		content: z.string(),
	}) satisfies z.ZodType<VaultReadOutput>,
	"vault.write@1": z.object({
		path: z.string(),
		created: z.boolean(),
	}) satisfies z.ZodType<VaultWriteOutput>,
	"knowledge.search@1": z.object({
		results: z.array(hit),
	}) satisfies z.ZodType<KnowledgeSearchOutput>,
	"browser.screenshot@2": z.object({
		path: z.string(),
		width: z.number(),
		height: z.number(),
	}) satisfies z.ZodType<BrowserScreenshotOutput>,
	"seo.audit@2": z.object({
		scores: SeoScoresSchema,
		audits: z.array(audit),
		reportPath: z.string(),
	}) satisfies z.ZodType<SeoAuditOutput>,
};

/** Validates non-shell catalog results; an unknown validator never certifies success. */
export const validVerificationOutput = (
	ref: CapabilityRef,
	value: unknown,
	args?: Record<string, unknown>,
) => {
	if (ref === "vcs.git@2") {
		const parsed = git.safeParse(value);
		return parsed.success && parsed.data.op === args?.op;
	}
	const schema = MAPPABLE_OUTPUTS[ref] ?? outputs[ref];
	return schema?.safeParse(value).success === true;
};
