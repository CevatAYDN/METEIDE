import {
	err,
	ok,
	type Result,
	type ToolContext,
	type ToolError,
	WebSearchInputSchema,
	type WebSearchOutput,
} from "@mete/contracts";
import { z } from "zod";
import {
	TAVILY_MAX_RESULTS,
	TAVILY_SEARCH_URL,
	WEB_FETCH_TIMEOUT_MS,
} from "../defaults.js";
import { parse, permit } from "./fs-common.js";
import type { WebDeps } from "./web-fetch.js";

// web.search@1 through Tavily's HTTP API (docs/10; docs/05, search providers), checked by
// policy.check@1 with action net.fetch. The answer is parsed at the boundary.
// shortcut: Tavily only; the Exa API, You.com and Firecrawl adapters come when a key for them
// is in use, and Exa MCP with the MCP client (Phase 3).

const AnswerSchema = z.object({
	results: z.array(
		z.object({ title: z.string(), url: z.string(), content: z.string() }),
	),
});

type Out<T> = Promise<Result<T, ToolError>>;

const io = (message: string): ToolError => ({ code: "io", message });

const post = async (
	deps: WebDeps & { apiKey: string },
	body: unknown,
	signal: AbortSignal,
): Out<unknown> => {
	try {
		const res = await deps.fetch(TAVILY_SEARCH_URL, {
			method: "POST",
			headers: {
				authorization: `Bearer ${deps.apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
			signal,
		});
		const text = await res.text();
		if (!res.ok)
			return err(io(`Tavily answered ${res.status}: ${text.slice(0, 200)}`));
		return ok(JSON.parse(text));
	} catch (e) {
		return err(io(`Tavily: ${e instanceof Error ? e.message : String(e)}`));
	}
};

/** web.search@1: titles, URLs and snippets from Tavily. */
export const tavilySearch = async (
	deps: WebDeps & { apiKey: string },
	input: unknown,
	ctx: ToolContext,
): Out<WebSearchOutput> => {
	const i = parse(WebSearchInputSchema, input);
	if (!i.ok) return i;
	const check = {
		action: "net.fetch",
		capability: "web.search@1",
		args: i.value,
	} as const;
	const allowed = permit(deps, check, ctx);
	if (!allowed.ok) return allowed;
	const signal = AbortSignal.any([
		ctx.signal,
		AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
	]);
	const max_results = Math.min(i.value.maxResults, TAVILY_MAX_RESULTS);
	const answer = await post(
		deps,
		{ query: i.value.query, max_results },
		signal,
	);
	if (!answer.ok) return answer;
	const parsed = AnswerSchema.safeParse(answer.value);
	if (!parsed.success) return err(io("Tavily sent an answer METE cannot read"));
	const results = parsed.data.results.map((r) => ({
		title: r.title,
		url: r.url,
		snippet: r.content,
	}));
	return ok({ results });
};
