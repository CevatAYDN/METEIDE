import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

// A page to clean Markdown (docs/05, Web reading): linkedom parses it, Readability keeps the
// article, turndown writes Markdown. A page Readability finds no article in keeps its body.

/** The title and the Markdown of an HTML page. */
export const pageMarkdown = (
	html: string,
): { title: string; markdown: string } => {
	const { document } = parseHTML(html);
	const title = document.title.trim();
	// Readability changes the document it reads, so the body is taken first.
	const body = document.body?.innerHTML ?? "";
	const article = new Readability(document).parse();
	const turndown = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
	});
	const markdown = turndown.turndown(article?.content ?? body).trim();
	return { title: article?.title?.trim() || title, markdown };
};
