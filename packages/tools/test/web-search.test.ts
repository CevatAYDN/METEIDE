import {
	ok,
	type PolicyCheckAdapter,
	type PolicyCheckInput,
	type Result,
	type ToolError,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { tavilySearch } from "../src/application/web-search.js";

// A hand-written fake of Tavily's POST /search; no test reaches the network.

const ctx = { signal: new AbortController().signal, runId: "r1" };
const code = <T>(r: Result<T, ToolError>) => (r.ok ? "ok" : r.error.code);

const setup = (status = 200, body: unknown = { results: [] }) => {
	const asked: PolicyCheckInput[] = [];
	const sent: { url: string; init: RequestInit | undefined }[] = [];
	const policy: PolicyCheckAdapter = {
		check: (i) => {
			asked.push(i);
			return ok({ verdict: "allow", rule: "test" });
		},
	};
	const fake: typeof fetch = async (input, init) => {
		sent.push({ url: String(input), init });
		return new Response(JSON.stringify(body), { status });
	};
	const deps = {
		adapterId: "tools-web",
		policy: () => policy,
		fetch: fake,
		apiKey: "tvly-test",
	};
	return { deps, asked, sent };
};

describe("web.search@1 through Tavily", () => {
	it("asks the policy, sends the key as a bearer token and maps the results", async () => {
		const { deps, asked, sent } = setup(200, {
			query: "free models",
			results: [
				{
					title: "Models",
					url: "https://openrouter.ai/models",
					content: "Free models",
					score: 0.9,
				},
			],
		});
		const r = await tavilySearch(deps, { query: "free models" }, ctx);
		expect(asked[0]).toMatchObject({
			action: "net.fetch",
			capability: "web.search@1",
		});
		expect(sent[0]?.url).toBe("https://api.tavily.com/search");
		const headers = new Headers(sent[0]?.init?.headers);
		expect(headers.get("authorization")).toBe("Bearer tvly-test");
		expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({
			query: "free models",
			max_results: 8,
		});
		expect(r.ok && r.value.results).toEqual([
			{
				title: "Models",
				url: "https://openrouter.ai/models",
				snippet: "Free models",
			},
		]);
	});

	it("asks for at most 20 results, Tavily's limit", async () => {
		const { deps, sent } = setup();
		await tavilySearch(deps, { query: "q", maxResults: 50 }, ctx);
		expect(JSON.parse(String(sent[0]?.init?.body)).max_results).toBe(20);
	});

	it("answers io for a refused key, a spent plan and an unreadable answer", async () => {
		for (const [status, body] of [
			[401, { detail: { error: "Unauthorized" } }],
			[432, { detail: { error: "plan limit" } }],
			[200, { results: "nope" }],
		] as const) {
			const { deps } = setup(status, body);
			expect(code(await tavilySearch(deps, { query: "q" }, ctx))).toBe("io");
		}
	});

	it("refuses an empty query before any request", async () => {
		const { deps, sent } = setup();
		expect(code(await tavilySearch(deps, { query: " " }, ctx))).toBe(
			"bad_input",
		);
		expect(sent).toEqual([]);
	});
});
