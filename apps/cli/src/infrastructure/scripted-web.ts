import { readFileSync } from "node:fs";
import { ok, type SecretStore } from "@mete/contracts";
import { searchKeyName } from "@mete/tools";
import { z } from "zod";

// The web answers of a scripted app (docs/15, LLM replay; ADR-116): METE_SCRIPTED_WEB names a JSON
// file whose results every web.search@1 call returns and whose pages web.fetch@1 reads, and the app
// keeps its keys in memory, so a test script reaches neither the network nor the developer's own
// keychain. It is the web half of ADR-111's chat script and is unset in normal use.

const ScriptSchema = z.strictObject({
	/** What every web.search@1 call returns, in Tavily's shape without the scores. */
	results: z
		.array(
			z.strictObject({
				title: z.string().min(1),
				url: z.string().url(),
				snippet: z.string(),
			}),
		)
		.default([]),
	/** The page web.fetch@1 reads for a URL, by URL. */
	pages: z.record(z.string(), z.string()).default({}),
});

/** What a scripted app answers its web tools with. */
export type WebScript = z.output<typeof ScriptSchema>;

/** Tavily's search endpoint, the adapter the built-in chain reaches once the Exa server is offline (docs/10). */
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

/** The script a path names; a bad file fails the app with its path, not with a stack of JSON. */
export const readWebScript = (file: string): WebScript => {
	try {
		return ScriptSchema.parse(JSON.parse(readFileSync(file, "utf8")));
	} catch (e) {
		throw new Error(
			`METE_SCRIPTED_WEB ${file}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
};

const urlOf = (input: Parameters<typeof fetch>[0]): string => {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
};

const answer = (body: string, type: string) =>
	new Response(body, { status: 200, headers: { "content-type": type } });

/**
 * The fetch a scripted app gives its web tools and the MCP client: Tavily's search answers from the
 * script, a listed page with its HTML, and anything else 404 — which leaves the built-in Exa server
 * offline, so the chain falls back to Tavily as it does for a user without network to Exa.
 */
export const scriptedWeb = (file: string): typeof fetch => {
	const script = readWebScript(file);
	return async (input) => {
		const url = urlOf(input);
		if (url === TAVILY_SEARCH_URL)
			return answer(
				JSON.stringify({
					results: script.results.map((r) => ({
						title: r.title,
						url: r.url,
						content: r.snippet,
					})),
				}),
				"application/json",
			);
		const page = script.pages[url];
		return page === undefined
			? new Response("", { status: 404 })
			: answer(page, "text/html; charset=utf-8");
	};
};

/** A keychain held in memory, seeded with the search provider's key (docs/10). */
export const scriptedSecrets = (): SecretStore => {
	const keys = new Map([[searchKeyName("tavily"), "scripted"]]);
	return {
		get: async (name) => ok(keys.get(name)),
		set: async (name, value) => ok(void keys.set(name, value)),
		delete: async (name) => ok(keys.delete(name)),
	};
};
