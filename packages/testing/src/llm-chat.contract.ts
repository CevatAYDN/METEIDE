import type { LlmChatAdapter, LlmChatRequest, LlmChunk } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for llm.chat@2 (docs/06 llm types, docs/09 Gateway).

/**
 * What sits behind the adapter: one model that answers with text, no model that
 * fits, or a model whose quota is used up.
 */
export type LlmScenario = "ok" | "no-model" | "quota-exhausted";

/** Opens an adapter for one scenario; `target` is what the kit asks for. */
export type LlmChatHarness = (scenario: LlmScenario) => Promise<{
	readonly adapter: LlmChatAdapter;
	readonly target: LlmChatRequest["target"];
	readonly close: () => Promise<void>;
}>;

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";

const collect = async (chunks: AsyncIterable<LlmChunk>) => {
	const out: LlmChunk[] = [];
	for await (const c of chunks) out.push(c);
	return out;
};

const terminal = (c: LlmChunk) => c.type === "finish" || c.type === "error";

/** Every llm.chat@2 adapter MUST pass these tests. */
export const llmChatContract = (name: string, open: LlmChatHarness) =>
	describe(`llm.chat@2 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const run = async (scenario: LlmScenario, signal: AbortSignal) => {
			const h = await open(scenario);
			close = h.close;
			return collect(
				h.adapter.chat(
					{
						target: h.target,
						runId: RUN,
						priority: 0,
						messages: [{ role: "user", content: "hi" }],
					},
					signal,
				),
			);
		};

		it("names the model first, streams text and ends with one finish", async () => {
			const out = await run("ok", new AbortController().signal);
			expect(out[0]).toMatchObject({ type: "model", reason: "first" });
			expect(out.some((c) => c.type === "text")).toBe(true);
			expect(out.filter(terminal)).toHaveLength(1);
			expect(out.at(-1)?.type).toBe("finish");
		});

		it("ends with one no_model error when no model fits", async () => {
			const out = await run("no-model", new AbortController().signal);
			expect(out).toHaveLength(1);
			expect(out[0]).toMatchObject({
				type: "error",
				error: { code: "no_model" },
			});
		});

		it("ends with one quota_exhausted error that says when it resumes", async () => {
			const out = await run("quota-exhausted", new AbortController().signal);
			expect(out).toHaveLength(1);
			const [only] = out;
			expect(only?.type).toBe("error");
			if (only?.type !== "error" || only.error.code !== "quota_exhausted")
				throw new Error("expected quota_exhausted");
			expect(Number.isNaN(Date.parse(only.error.resumesAt))).toBe(false);
		});

		it("ends an aborted call with one aborted error", async () => {
			const c = new AbortController();
			c.abort();
			const out = await run("ok", c.signal);
			expect(out.filter(terminal)).toHaveLength(1);
			expect(out.at(-1)).toMatchObject({
				type: "error",
				error: { code: "aborted" },
			});
		});
	});
