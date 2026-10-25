// A page to clean Markdown (docs/05, Web reading): linkedom parses it, Readability keeps the
// article, turndown writes Markdown. A page Readability finds no article in keeps its body. The
// three parsers load on the first page fetched, not with the package: a CLI start loads this file
// for every command, and a status run reads no page (docs/15, cold start).

/** The title and the Markdown of an HTML page. */
export const pageMarkdown = async (
	html: string,
): Promise<{ title: string; markdown: string }> => {
	const [{ Readability }, { parseHTML }, { default: TurndownService }] =
		await Promise.all([
			import("@mozilla/readability"),
			import("linkedom"),
			import("turndown"),
		]);
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
