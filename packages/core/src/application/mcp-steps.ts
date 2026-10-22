import {
	err,
	type McpToolsAdapter,
	type Result,
	type ToolCall,
	type ToolContext,
	type ToolSpec,
} from "@mete/contracts";
import type { CapabilityRegistry, Logger } from "@mete/kernel";
import { z } from "zod";
import { mcpModelTools } from "../domain/mcp-tools.js";
import type { EventBody } from "../domain/run-events.js";
import { allowed, type Seat } from "../domain/tools.js";

// The raw MCP tools of a seat that lists mcp.tools@1 (docs/10, Integration levels, level 1).
// steps.ts offers and runs them; their results are external content like web results.

type Deps = {
	readonly registry: CapabilityRegistry;
	readonly logger: Logger;
	readonly now: () => number;
};
type Failure = { readonly code: string; readonly message: string };

const MCP = "mcp.tools@1";

const adapter = (deps: Deps, seat: Seat) => {
	if (!allowed(seat, MCP)) return undefined;
	const chain = deps.registry.resolve<McpToolsAdapter>(MCP);
	return chain.ok ? chain.value[0] : undefined;
};

// shortcut: listing starts every configured server (docs/10, MCP client) and runs on every model
// call; the sessions keep each server's tool list, so only the first call pays for the starts.
const listed = async (
	deps: Deps,
	impl: McpToolsAdapter,
	signal: AbortSignal,
) => {
	const all = await impl.list(signal);
	if (!all.ok) {
		deps.logger.warn({ reason: all.error.message }, "MCP tools not listed");
		return new Map();
	}
	const { tools, skipped } = mcpModelTools(all.value);
	for (const s of skipped) deps.logger.warn(s, "MCP tool left out");
	return tools;
};

/** The model tools of the seat's MCP servers; none, without waiting, when the seat does not list mcp.tools@1. */
export const mcpSpecs = (
	deps: Deps,
	seat: Seat,
	signal: AbortSignal,
): ToolSpec[] | Promise<ToolSpec[]> => {
	const a = adapter(deps, seat);
	if (!a) return [];
	return listed(deps, a.impl, signal).then((tools) =>
		[...tools.values()].map((t) => t.spec),
	);
};

const ArgsSchema = z.record(z.string(), z.unknown());

/** Runs an MCP model tool call; undefined when the name is not one of the seat's MCP tools. */
export const runMcpTool = async (
	deps: Deps,
	{ call, seat }: { call: ToolCall; seat: Seat },
	ctx: ToolContext,
	emit: (body: EventBody) => void,
): Promise<Result<unknown, Failure> | undefined> => {
	const a = call.name.startsWith("mcp_") ? adapter(deps, seat) : undefined;
	const target = a && (await listed(deps, a.impl, ctx.signal)).get(call.name);
	if (!a || !target) return undefined;
	const args = ArgsSchema.safeParse(call.args);
	if (!args.success)
		return err({ code: "bad_input", message: z.prettifyError(args.error) });
	emit({
		type: "agent.tool.called",
		payload: { capability: MCP, adapterId: a.id },
	});
	const t0 = deps.now();
	const input = { server: target.server, tool: target.tool, args: args.data };
	const out = await a.impl.call(input, ctx);
	emit({
		type: "agent.tool.completed",
		payload: {
			capability: MCP,
			ok: out.ok,
			durationMs: Math.max(0, deps.now() - t0),
			...(out.ok ? {} : { error: { code: out.error.code } }),
		},
	});
	return out;
};
