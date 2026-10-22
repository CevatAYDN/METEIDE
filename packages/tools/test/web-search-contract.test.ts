import { ok, type PolicyCheckAdapter } from "@mete/contracts";
import { webSearchContract } from "@mete/testing";
import { tavilySearch } from "../src/application/web-search.js";

// Tavily's POST /search as a fake backend that, like the real one, answers at most max_results.
webSearchContract("tools-web tavily", async (verdict, world) => {
	const policy: PolicyCheckAdapter = {
		check: () => ok({ verdict, rule: "kit" }),
	};
	const fake: typeof fetch = async (_url, init) => {
		if (world === "down") return new Response("down", { status: 503 });
		const { max_results } = JSON.parse(String(init?.body));
		const results = world.hits
			.slice(0, max_results)
			.map((h) => ({ title: h.title, url: h.url, content: h.snippet }));
		return Response.json({ results });
	};
	const deps = {
		adapterId: "tools-web",
		policy: () => policy,
		fetch: fake,
		apiKey: "tvly-test",
	};
	return {
		adapter: { run: (input, ctx) => tavilySearch(deps, input, ctx) },
		close: async () => {},
	};
});
