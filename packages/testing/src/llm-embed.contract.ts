import type { LlmEmbedAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { LlmScenario } from "./llm-chat.contract.js";

// Contract kit for llm.embed@1 (docs/06 llm types, docs/09 Gateway, ADR-152).

/** Opens an adapter for one scenario: one embedding model, none, or one whose quota is used up. */
export type LlmEmbedHarness = (scenario: LlmScenario) => Promise<{
	readonly adapter: LlmEmbedAdapter;
	readonly close: () => Promise<void>;
}>;

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";

/** Every llm.embed@1 adapter MUST pass these tests. */
export const llmEmbedContract = (name: string, open: LlmEmbedHarness) =>
	describe(`llm.embed@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const run = async (scenario: LlmScenario, signal: AbortSignal) => {
			const h = await open(scenario);
			close = h.close;
			return h.adapter.embed(
				{
					input: ["a cup", "a mug"],
					purpose: "document",
					runId: RUN,
					priority: 2,
				},
				signal,
			);
		};
		const errorOf = async (scenario: LlmScenario, signal: AbortSignal) => {
			const r = await run(scenario, signal);
			if (r.ok) throw new Error("expected an error");
			return r.error;
		};

		it("answers one vector per input, all of one length, and the model that made them", async () => {
			const r = await run("ok", new AbortController().signal);
			if (!r.ok) throw new Error(r.error.message);
			const [first, second] = r.value.vectors;
			expect(r.value.vectors).toHaveLength(2);
			expect(first?.length).toBeGreaterThan(0);
			expect(second).toHaveLength(first?.length ?? -1);
			expect(r.value.model.providerId).not.toBe("");
			expect(r.value.model.modelId).not.toBe("");
		});

		it("answers no_model when no embedding model is allowed", async () => {
			const e = await errorOf("no-model", new AbortController().signal);
			expect(e.code).toBe("no_model");
		});

		it("answers quota_exhausted with the time it resumes", async () => {
			const e = await errorOf("quota-exhausted", new AbortController().signal);
			if (e.code !== "quota_exhausted") throw new Error(e.code);
			expect(Number.isNaN(Date.parse(e.resumesAt))).toBe(false);
		});

		it("answers an aborted call with aborted", async () => {
			const c = new AbortController();
			c.abort();
			expect((await errorOf("ok", c.signal)).code).toBe("aborted");
		});
	});
