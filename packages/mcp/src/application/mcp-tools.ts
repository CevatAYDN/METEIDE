import {
	err,
	type McpCallInput,
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
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { toContent } from "./content.js";
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

const caller = (ctx: ToolContext) => ({
	...(ctx.runId === undefined ? {} : { runId: ctx.runId }),
	...(ctx.agentId === undefined ? {} : { agentId: ctx.agentId }),
	...(ctx.tainted === undefined ? {} : { tainted: ctx.tainted }),
});

const permit = (
	deps: McpToolsDeps,
	input: Required<McpCallInput> & { args: Record<string, unknown> },
	ctx: ToolContext,
): Result<void, ToolError> => {
	const policy = deps.policy();
	const command = `${input.server}/${input.tool}`;
	if (!policy)
		return err({
			code: "denied",
			rule: "capability_missing",
			message: "policy.check@1 is not provided",
		});
	const v = policy.check({
		action: "mcp.call",
		capability: "mcp.tools@1",
		adapterId: deps.adapterId,
		command,
		args: input.args,
		...caller(ctx),
	});
	if (!v.ok)
		return err({
			code: "denied",
			rule: "audit_failed",
			message: v.error.message,
		});
	const { verdict, rule } = v.value;
	if (verdict === "allow") return ok(undefined);
	const code = verdict === "ask" ? "approval_required" : "denied";
	return err({
		code,
		rule,
		message: `mcp.call ${command}: ${verdict} (${rule})`,
	});
};

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
		const allowed = permit(deps, input, ctx);
		if (!allowed.ok) return allowed;
		const s = await deps.sessions.get(input.server, ctx.signal);
		if (!s.ok) return s;
		if (!s.value.tools.some((t) => t.name === input.tool))
			return err({
				code: "not_found",
				message: `MCP server ${input.server} has no tool ${input.tool}`,
			});
		return invoke(deps.workspaceDir, s.value, input, ctx.signal);
	};

const invoke = async (
	workspaceDir: string,
	session: Session,
	input: { server: string; tool: string; args: Record<string, unknown> },
	signal: AbortSignal,
): Promise<Result<McpCallOutput, ToolError>> => {
	try {
		const r = await session.client.callTool(
			{ name: input.tool, arguments: input.args },
			undefined,
			{ signal },
		);
		// A server on the old protocol answers with toolResult instead of content.
		const blocks = (r.content ?? [
			{ type: "text", text: JSON.stringify(r.toolResult) },
		]) as ContentBlock[];
		const content = await toContent(workspaceDir, blocks);
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
