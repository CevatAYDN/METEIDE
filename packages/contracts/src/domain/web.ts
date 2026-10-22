import { z } from "zod";
import { WEB_SEARCH_MAX_RESULTS } from "../defaults.js";

// web.fetch@1 and web.search@1 from docs/10 (Built-in tools); adapters return ToolError (tools.ts).

const webUrl = z.url({ protocol: /^https?$/ });

/** Input of web.fetch@1: one http or https page. */
export const WebFetchInputSchema = z.strictObject({ url: webUrl });
export type WebFetchInput = z.infer<typeof WebFetchInputSchema>;
/** The page as clean Markdown; finalUrl is where the redirects ended. */
export type WebFetchOutput = {
	readonly markdown: string;
	readonly title: string;
	readonly finalUrl: string;
};

/** Input of web.search@1; maxResults defaults to 8 (docs/10). */
export const WebSearchInputSchema = z.strictObject({
	query: z.string().trim().min(1),
	maxResults: z.number().int().positive().default(WEB_SEARCH_MAX_RESULTS),
});
export type WebSearchInput = z.input<typeof WebSearchInputSchema>;
export type WebSearchOutput = {
	readonly results: readonly {
		readonly title: string;
		readonly url: string;
		readonly snippet: string;
	}[];
};

/** Output of web.search@1, checked where an adapter's answer is mapped (docs/10, Integration levels). */
export const WebSearchOutputSchema = z.strictObject({
	results: z
		.array(
			z.strictObject({ title: z.string(), url: webUrl, snippet: z.string() }),
		)
		.readonly(),
}) satisfies z.ZodType<WebSearchOutput>;
