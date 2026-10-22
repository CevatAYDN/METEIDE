import {
	err,
	McpCallInputSchema,
	type McpCallOutput,
	type McpToolInfo,
	type McpToolsAdapter,
	ok,
	type PolicyCheckAdapter,
	type Result,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import type { Logger } from "@mete/kernel";
import type {
	ContentBlock,
	Progress,
} from "@modelcontextprotocol/sdk/types.js";
import { toContent } from "./content.js";
import { permit } from "./permit.js";
import type { Session, Sessions } from "./sessions.js";

// mcp.tools@1 (docs/10, level 1 raw access): every call asks policy.check@1 with action
// mcp.call first; the core labels and taints what comes back (docs/06).

export type McpToolsDeps = {
	readonly adapterId: string;
	readonly workspaceDir: string;
	readonly sessions: Sessions;
	readonly policy: () => PolicyCheckAdapter | undefined;
	readonly logger: Logger;
};

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

const list: (deps: McpToolsDeps) => McpToolsAdapter["list"] =
	(deps) => async (signal) => {
		const all: McpToolInfo[] = [];
		for (const { id } of deps.sessions.servers) {
			const s = await deps.sessions.get(id, signal);
			// One broken server must not hide the others; it is logged with its reason.
			if (!s.ok) {
				deps.logger.warn(
					{ moduleId: deps.adapterId, server: id, reason: s.error.message },
					"MCP server skipped in list",
				);
				continue;
			}
			for (const t of s.value.tools)
				all.push({
					server: id,
					name: t.name,
					description: t.description ?? "",
					inputSchema: t.inputSchema,
				});
		}
		return ok(all);
	};

const call: (deps: McpToolsDeps) => McpToolsAdapter["call"] =
	(deps) => async (raw, ctx) => {
		const parsed = McpCallInputSchema.safeParse(raw);
		if (!parsed.success)
			return err({ code: "bad_input", message: parsed.error.message });
		const input = parsed.data;
		const allowed = permit(
			deps.policy(),
			{
				adapterId: deps.adapterId,
				action: "mcp.call",
				capability: "mcp.tools@1",
				command: `${input.server}/${input.tool}`,
				args: input.args,
			},
			ctx,
		);
		if (!allowed.ok) return allowed;
		const s = await deps.sessions.get(input.server, ctx.signal);
		if (!s.ok) return s;
		if (!s.value.tools.some((t) => t.name === input.tool))
			return err({
				code: "not_found",
				message: `MCP server ${input.server} has no tool ${input.tool}`,
			});
		return invoke(deps, s.value, input, ctx);
	};

type Call = { server: string; tool: string; args: Record<string, unknown> };

const callOptions = (deps: McpToolsDeps, input: Call, ctx: ToolContext) => ({
	signal: ctx.signal,
	// A tool that reports progress is a long one; the SDK's request timeout would kill it otherwise.
	resetTimeoutOnProgress: true,
	// shortcut: progress reaches the log only; upgrade with the team panel (Phase 5, docs/10).
	onprogress: (p: Progress) =>
		deps.logger.info(
			{
				moduleId: deps.adapterId,
				server: input.server,
				tool: input.tool,
				...p,
			},
			"MCP tool progress",
		),
});

const invoke = async (
	deps: McpToolsDeps,
	session: Session,
	input: Call,
	ctx: ToolContext,
): Promise<Result<McpCallOutput, ToolError>> => {
	try {
		const r = await session.client.callTool(
			{ name: input.tool, arguments: input.args },
			undefined,
			callOptions(deps, input, ctx),
		);
		// A server on the old protocol answers with toolResult instead of content.
		const blocks = (r.content ?? [
			{ type: "text", text: JSON.stringify(r.toolResult) },
		]) as ContentBlock[];
		const { server, tool } = input;
		const origin = { server, tool, ...(ctx.runId ? { runId: ctx.runId } : {}) };
		const content = await toContent(
			{ workspaceDir: deps.workspaceDir, origin },
			blocks,
		);
		return ok({ content, isError: r.isError === true });
	} catch (e) {
		return err({
			code: "io",
			message: `MCP server ${input.server} tool ${input.tool}: ${why(e)}`,
		});
	}
};

/** The mcp.tools@1 implementation over the configured servers. */
export const mcpTools = (deps: McpToolsDeps): McpToolsAdapter => ({
	list: list(deps),
	call: call(deps),
});
