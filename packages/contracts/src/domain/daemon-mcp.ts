import { z } from "zod";

// The Settings screen's MCP servers request of the daemon protocol (ARCHITECTURE.md, ADR-164).

const text = z.string().min(1);

/** Params of `mete/mcp.test`: one server of the loaded `mcp` section, by its id. */
export const DaemonMcpTestParamsSchema = z.strictObject({ id: text });

/** Result of `mete/mcp.test`: the names of the tools the server lists, or why connecting failed. */
export const DaemonMcpTestResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({
		id: text,
		ok: z.literal(true),
		tools: z.array(text),
		ms: z.number().int().nonnegative(),
	}),
	z.strictObject({
		id: text,
		ok: z.literal(false),
		failed: z.strictObject({ code: text, message: z.string() }),
	}),
]);
