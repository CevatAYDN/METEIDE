import {
	ok,
	type PolicyCheckAdapter,
	type PolicyCheckInput,
	type Result,
	type ToolError,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { fetchTool, type WebDeps } from "../src/application/web-fetch.js";
import { WEB_FETCH_MAX_BYTES, WEB_FETCH_MAX_CHARS } from "../src/defaults.js";

// Hand-written fetch fakes; no test reaches the network (AGENTS.md rule 7).

const ctx = { signal: new AbortController().signal, runId: "r1" };
const code = <T>(r: Result<T, ToolError>) => (r.ok ? "ok" : r.error.code);

const ARTICLE = `<html><head><title>Free models</title></head><body>
<nav>menu</nav><article><h1>Free models</h1>
<p>OpenRouter lists <a href="https://openrouter.ai/models">free models</a> for everyone to use today.</p>
<p>NVIDIA hosts free endpoints as well, with a daily limit that resets at midnight.</p>
</article></body></html>`;

type Route = {
	status?: number;
	headers?: Record<string, string>;
	body?: string;
};

const setup = (
	routes: Record<string, Route>,
	verdict: "allow" | "deny" = "allow",
) => {
	const asked: PolicyCheckInput[] = [];
	const fetched: string[] = [];
	const policy: PolicyCheckAdapter = {
		check: (i) => {
			asked.push(i);
			return ok({ verdict, rule: "test" });
		},
	};
	const fake: typeof fetch = async (input) => {
		const url = String(input);
		fetched.push(url);
		const r = routes[url] ?? { status: 404 };
		return new Response(r.body ?? "", {
			status: r.status ?? 200,
			headers: { "content-type": "text/html; charset=utf-8", ...r.headers },
		});
	};
	const deps: WebDeps = {
		adapterId: "tools-web",
		policy: () => policy,
		fetch: fake,
	};
	return { deps, asked, fetched };
};

describe("web.fetch@1", () => {
	it("asks the policy for net.fetch and returns the article as Markdown", async () => {
		const { deps, asked } = setup({ "https://a.org/": { body: ARTICLE } });
		const r = await fetchTool(deps, { url: "https://a.org/" }, ctx);
		expect(asked[0]).toMatchObject({
			action: "net.fetch",
			capability: "web.fetch@1",
			runId: "r1",
		});
		if (!r.ok) throw new Error(r.error.message);
		expect(r.value.title).toBe("Free models");
		expect(r.value.finalUrl).toBe("https://a.org/");
		expect(r.value.markdown).toContain(
			"[free models](https://openrouter.ai/models)",
		);
		expect(r.value.markdown).not.toContain("menu");
	});

	it("follows redirects and refuses one that leads to a private address", async () => {
		const { deps, fetched } = setup({
			"https://a.org/old": { status: 301, headers: { location: "/new" } },
			"https://a.org/new": { body: ARTICLE },
			"https://b.org/": {
				status: 302,
				headers: { location: "http://169.254.169.254/" },
			},
		});
		const moved = await fetchTool(deps, { url: "https://a.org/old" }, ctx);
		expect(moved.ok && moved.value.finalUrl).toBe("https://a.org/new");
		const sneaky = await fetchTool(deps, { url: "https://b.org/" }, ctx);
		expect(code(sneaky)).toBe("bad_input");
		expect(fetched).not.toContain("http://169.254.169.254/");
	});

	it("refuses a local address before any request", async () => {
		const { deps, fetched } = setup({});
		const r = await fetchTool(deps, { url: "http://localhost:4111/v1" }, ctx);
		expect(code(r)).toBe("bad_input");
		expect(fetched).toEqual([]);
	});

	it("returns a denied verdict without fetching", async () => {
		const { deps, fetched } = setup({}, "deny");
		expect(code(await fetchTool(deps, { url: "https://a.org/" }, ctx))).toBe(
			"denied",
		);
		expect(fetched).toEqual([]);
	});

	it("gives up on a response larger than the byte cap", async () => {
		const huge = "x".repeat(WEB_FETCH_MAX_BYTES + 1);
		const { deps } = setup({ "https://a.org/big": { body: huge } });
		const r = await fetchTool(deps, { url: "https://a.org/big" }, ctx);
		expect(r.ok ? "ok" : r.error.message).toContain("larger than");
	});

	it("keeps plain text, refuses other types and cuts long pages", async () => {
		const long = "x".repeat(WEB_FETCH_MAX_CHARS + 10);
		const { deps } = setup({
			"https://a.org/t.txt": {
				body: long,
				headers: { "content-type": "text/plain" },
			},
			"https://a.org/x.png": {
				body: "PNG",
				headers: { "content-type": "image/png" },
			},
			"https://a.org/gone": { status: 500 },
		});
		const text = await fetchTool(deps, { url: "https://a.org/t.txt" }, ctx);
		expect(text.ok && text.value.markdown.length).toBe(WEB_FETCH_MAX_CHARS);
		expect(
			code(await fetchTool(deps, { url: "https://a.org/x.png" }, ctx)),
		).toBe("bad_input");
		expect(
			code(await fetchTool(deps, { url: "https://a.org/gone" }, ctx)),
		).toBe("io");
	});
});
