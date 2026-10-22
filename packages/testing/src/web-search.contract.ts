import {
	type PolicyVerdict,
	type ToolAdapter,
	type WebSearchInput,
	type WebSearchOutput,
	WebSearchOutputSchema,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for web.search@1 (docs/10 Built-in tools). Any adapter can stand in for another in
// the fallback chain (docs/06), so each one is checked against the same backend behaviour.

/** One result as the adapter must hand it on. */
export type WebSearchHit = {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
};

/**
 * What the search backend does for the test: answers these hits (at most as many as the request
 * asks for, as a real backend does), or is down.
 */
export type WebSearchWorld =
	| { readonly hits: readonly WebSearchHit[] }
	| "down";

/** Opens the adapter on a backend that behaves as `world`; its policy.check@1 always answers `verdict`. */
export type WebSearchHarness = (
	verdict: PolicyVerdict["verdict"],
	world: WebSearchWorld,
) => Promise<{
	readonly adapter: ToolAdapter<WebSearchInput, WebSearchOutput>;
	readonly close: () => Promise<void>;
}>;

const ctx = { signal: new AbortController().signal };
// docs/10: maxResults defaults to 8.
const DEFAULT_MAX = 8;

const hits = (n: number): WebSearchHit[] =>
	Array.from({ length: n }, (_, i) => ({
		title: `Title ${i}`,
		url: `https://r${i}.example/page`,
		snippet: `Snippet ${i}`,
	}));

/** Every web.search@1 adapter MUST pass these tests. */
export const webSearchContract = (name: string, open: WebSearchHarness) =>
	describe(`web.search@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const search = async (
			input: WebSearchInput,
			world: WebSearchWorld,
			verdict: PolicyVerdict["verdict"] = "allow",
		) => {
			const h = await open(verdict, world);
			close = h.close;
			return h.adapter.run(input, ctx);
		};

		it("returns the backend's results as title, url and snippet, in order", async () => {
			const r = await search({ query: "mete" }, { hits: hits(3) });
			expect(r.ok && r.value.results).toEqual(hits(3));
			expect(WebSearchOutputSchema.safeParse(r.ok && r.value).success).toBe(
				true,
			);
		});

		it("returns an empty list when the backend finds nothing", async () => {
			const r = await search({ query: "mete" }, { hits: [] });
			expect(r.ok && r.value.results).toEqual([]);
		});

		it("passes maxResults on, and asks for 8 results when it is not given", async () => {
			const world = { hits: hits(10) };
			const two = await search({ query: "mete", maxResults: 2 }, world);
			expect(two.ok && two.value.results).toHaveLength(2);
			await close?.();
			const dflt = await search({ query: "mete" }, world);
			expect(dflt.ok && dflt.value.results).toHaveLength(DEFAULT_MAX);
		});

		it("answers io when the backend is down", async () => {
			const r = await search({ query: "mete" }, "down");
			expect(r.ok === false && r.error.code).toBe("io");
		});

		it("refuses an empty query as bad_input", async () => {
			const r = await search({ query: "  " }, { hits: hits(1) });
			expect(r.ok === false && r.error.code).toBe("bad_input");
		});

		it("asks the policy first: ask is approval_required and deny is denied", async () => {
			const world = { hits: hits(1) };
			const ask = await search({ query: "mete" }, world, "ask");
			expect(ask.ok === false && ask.error.code).toBe("approval_required");
			await close?.();
			const deny = await search({ query: "mete" }, world, "deny");
			expect(deny.ok === false && deny.error.code).toBe("denied");
		});
	});
