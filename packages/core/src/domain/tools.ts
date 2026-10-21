import {
	type CapabilityRef,
	FsEditInputSchema,
	FsGlobInputSchema,
	FsGrepInputSchema,
	FsListInputSchema,
	FsReadInputSchema,
	FsWriteInputSchema,
	type LlmChatRequest,
	ShellExecInputSchema,
	type Tier,
	type ToolCall,
	type ToolSpec,
	VcsGitInputSchema,
} from "@mete/contracts";
import { z } from "zod";

// Workspace capabilities as model tools (docs/08, Single agent): `fs.read@1` becomes `fs_read`,
// with the JSON Schema of the capability's input schema.

// The model may commit, but checkpoints are the core's (the schema's first three options).
const [status, diff, commit] = VcsGitInputSchema.options;
export const VcsForModelSchema = z.discriminatedUnion("op", [
	status,
	diff,
	commit,
]);

type Entry = {
	readonly ref: CapabilityRef;
	readonly schema: z.ZodType;
	readonly description: string;
};

/** The workspace tools in the order the model sees them. */
export const WORKSPACE_TOOLS: readonly Entry[] = [
	{
		ref: "fs.read@1",
		schema: FsReadInputSchema,
		description: "Read a text file, optionally a 1-based inclusive line range.",
	},
	{
		ref: "fs.write@1",
		schema: FsWriteInputSchema,
		description:
			"Write a whole file (createOnly refuses an existing one) or delete it.",
	},
	{
		ref: "fs.edit@1",
		schema: FsEditInputSchema,
		description:
			"Replace oldStr with newStr in a file; oldStr must match exactly once unless replaceAll.",
	},
	{
		ref: "fs.list@1",
		schema: FsListInputSchema,
		description: "List the children of a folder; folder paths end with /.",
	},
	{
		ref: "fs.glob@1",
		schema: FsGlobInputSchema,
		description: "Find files whose paths match a glob pattern.",
	},
	{
		ref: "fs.grep@1",
		schema: FsGrepInputSchema,
		description: "Search file contents with a regular expression.",
	},
	{
		ref: "shell.exec@1",
		schema: ShellExecInputSchema,
		description:
			"Run a shell command in the workspace and return its exit code and output.",
	},
	{
		ref: "vcs.git@1",
		schema: VcsForModelSchema,
		description: "Show git status or a diff, or commit changes.",
	},
];

/** The model tool name of a capability. */
export const toolName = (ref: CapabilityRef) =>
	ref.replace(/@\d+$/, "").replaceAll(".", "_");

/** The capability behind a model tool name, if it is a workspace tool. */
export const capabilityOf = (name: string) =>
	WORKSPACE_TOOLS.find((t) => toolName(t.ref) === name)?.ref;

/** The tool spec the model is given for one workspace tool. */
export const toolSpec = (entry: Entry): ToolSpec => ({
	name: toolName(entry.ref),
	description: entry.description,
	parameters: z.toJSONSchema(entry.schema, { io: "input" }),
});

const WRITES: ReadonlySet<CapabilityRef> = new Set([
	"fs.write@1",
	"fs.edit@1",
	"shell.exec@1",
]);

/** Whether a tool call may write, so its step needs a checkpoint first. */
export const isWrite = (call: ToolCall) => {
	const ref = capabilityOf(call.name);
	if (ref === "vcs.git@1")
		return z.object({ op: z.literal("commit") }).safeParse(call.args).success;
	return ref !== undefined && WRITES.has(ref);
};

/** Who calls the model: a role's tier, needs and capabilities (docs/08); no list means every tool. */
export type Seat = {
	readonly tier: Tier;
	readonly needs: NonNullable<LlmChatRequest["needs"]>;
	readonly capabilities?: readonly string[];
};

/** The single agent of docs/08: the coder tier, tool calling and every workspace tool. */
export const SINGLE_AGENT: Seat = { tier: "coder", needs: ["tool_calling"] };

const FS_WILDCARD = /^fs\.\*@(\d+)$/;

// `fs.*@1` stands for every fs capability of that version (docs/08, Team template schema).
const covers = (granted: string, ref: string) => {
	const version = FS_WILDCARD.exec(granted)?.[1];
	if (version === undefined) return granted === ref;
	return ref.startsWith("fs.") && ref.endsWith(`@${version}`);
};

/** Whether a seat may use a capability. */
export const allowed = (seat: Seat, ref: string) =>
	seat.capabilities?.some((c) => covers(c, ref)) ?? true;
