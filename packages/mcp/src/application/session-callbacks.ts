import type {
	Client,
	ElicitRequestFormParams,
	ElicitResult,
} from "@modelcontextprotocol/client";
import type { z } from "zod";
import { redactWireValue } from "./redact-content.js";
import type { Sample } from "./sampling.js";

/** Asks the host to accept, decline or cancel a server's already-redacted form. */
export type Elicit = (
	server: string,
	params: ElicitRequestFormParams,
	signal: AbortSignal,
) => Promise<ElicitResult>;

const scrub = async <T>(
	params: unknown,
	schema: z.ZodType<T>,
	redact: (text: string) => string,
): Promise<T> => {
	const parsed = schema.safeParse(redactWireValue(params, redact));
	if (parsed.success) return parsed.data;
	// SDK handlers communicate expected refusals with protocol errors, not Result.
	const { ProtocolError, INVALID_PARAMS } = await import(
		"@modelcontextprotocol/client"
	);
	throw new ProtocolError(INVALID_PARAMS, "MCP callback payload is invalid");
};

/** Redacts every callback string and revalidates before model or host visibility. */
export const installSessionCallbacks = (
	client: Client,
	server: string,
	deps: {
		readonly sample?: Sample;
		readonly elicit?: Elicit;
		readonly redact: (text: string) => string;
	},
) => {
	const { sample, elicit, redact } = deps;
	if (sample)
		client.setRequestHandler(
			"sampling/createMessage",
			async ({ params }, ctx) => {
				const { CreateMessageRequestParamsSchema } = await import(
					"@modelcontextprotocol/core"
				);
				const safe = await scrub(
					params,
					CreateMessageRequestParamsSchema,
					redact,
				);
				return sample(server, safe, ctx.mcpReq.signal);
			},
		);
	if (elicit)
		client.setRequestHandler("elicitation/create", async ({ params }, ctx) => {
			if (params.mode === "url") return { action: "decline" };
			const { ElicitRequestFormParamsSchema } = await import(
				"@modelcontextprotocol/core"
			);
			const safe = await scrub(params, ElicitRequestFormParamsSchema, redact);
			return elicit(server, safe, ctx.mcpReq.signal);
		});
};
