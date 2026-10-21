import { z } from "zod";
import type { Result } from "./result.js";

// fs.*@1 and shell.exec@1 from docs/06 (Kernel API) and docs/10 (Built-in tools).

const path = z.string().min(1);
const line = z.number().int().positive();

/** Who calls a tool; passed on to policy.check@1. */
export type ToolContext = {
	readonly runId?: string;
	readonly agentId?: string;
	readonly tainted?: boolean;
	readonly signal: AbortSignal;
};

/** Why a tool call failed; `denied` and `approval_required` carry the policy rule. */
export type ToolError = { readonly message: string } & (
	| {
			readonly code:
				| "bad_input"
				| "not_found"
				| "outside_workspace"
				| "ignored"
				| "exists"
				| "is_directory"
				| "binary"
				| "io";
	  }
	| { readonly code: "match_count"; readonly count: number }
	| { readonly code: "denied" | "approval_required"; readonly rule: string }
);

/** Every fs.*@1 and shell.exec@1 capability is a ToolAdapter of its input and output. */
export interface ToolAdapter<I, O> {
	run(input: I, ctx: ToolContext): Promise<Result<O, ToolError>>;
}

/** Input of fs.read@1; lines are 1-based and inclusive. */
export const FsReadInputSchema = z
	.strictObject({ path, startLine: line.optional(), endLine: line.optional() })
	.refine((i) => (i.startLine ?? 1) <= (i.endLine ?? Number.MAX_SAFE_INTEGER), {
		message: "startLine must not be after endLine",
	});
export type FsReadInput = z.infer<typeof FsReadInputSchema>;
export type FsReadOutput = {
	readonly content: string;
	readonly totalLines: number;
	readonly lineEnding: "lf" | "crlf" | "mixed" | "none";
};

/** Input of fs.write@1: content to write, or a delete. */
export const FsWriteInputSchema = z.union([
	z.strictObject({
		path,
		content: z.string(),
		createOnly: z.boolean().optional(),
	}),
	z.strictObject({ path, delete: z.literal(true) }),
]);
export type FsWriteInput = z.infer<typeof FsWriteInputSchema>;
/** Bytes written; 0 for a delete. */
export type FsWriteOutput = { readonly bytes: number };

/** Input of fs.edit@1. */
export const FsEditInputSchema = z.strictObject({
	path,
	oldStr: z.string().min(1),
	newStr: z.string(),
	replaceAll: z.boolean().optional(),
});
export type FsEditInput = z.infer<typeof FsEditInputSchema>;
export type FsEditOutput = { readonly replacements: number };

/** Input of fs.list@1: the children of a folder. */
export const FsListInputSchema = z.strictObject({ path });
export type FsListInput = z.infer<typeof FsListInputSchema>;

/** Input of fs.glob@1. */
export const FsGlobInputSchema = z.strictObject({
	pattern: z.string().min(1),
	path: path.optional(),
});
export type FsGlobInput = z.infer<typeof FsGlobInputSchema>;

/** Output of fs.list@1 and fs.glob@1; folder paths end with "/". */
export type FsPathsOutput = { readonly paths: readonly string[] };

/** Input of fs.grep@1; maxResults defaults to 200 (docs/10). */
export const FsGrepInputSchema = z.strictObject({
	pattern: z.string().min(1),
	glob: z.string().min(1).optional(),
	caseSensitive: z.boolean().optional(),
	maxResults: line.optional(),
});
export type FsGrepInput = z.infer<typeof FsGrepInputSchema>;
export type FsGrepOutput = {
	readonly matches: readonly {
		readonly path: string;
		readonly line: number;
		readonly text: string;
	}[];
	readonly truncated: boolean;
};

/** Input of shell.exec@1; timeoutSec defaults to 120 (docs/10). */
export const ShellExecInputSchema = z.strictObject({
	command: z.string().min(1),
	cwd: path.optional(),
	timeoutSec: line.optional(),
	env: z.record(z.string(), z.string()).optional(),
});
export type ShellExecInput = z.infer<typeof ShellExecInputSchema>;
/** exitCode is null when the process was killed. */
export type ShellExecOutput = {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly os: string;
	readonly shell: string;
	readonly timedOut: boolean;
};

/** The `shell:` section of settings.yaml (docs/10, Built-in tools). */
export const ShellConfigSchema = z
	.strictObject({
		windows: z.enum(["powershell", "git-bash"]).default("powershell"),
		gitBashPath: path.optional(),
	})
	.refine((c) => c.windows !== "git-bash" || c.gitBashPath !== undefined, {
		message: "windows: git-bash needs gitBashPath",
		path: ["gitBashPath"],
	})
	.prefault({});
export type ShellConfig = z.infer<typeof ShellConfigSchema>;
