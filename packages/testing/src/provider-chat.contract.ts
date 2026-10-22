import {
	type ChatChunk,
	ModelInfoSchema,
	PrivacySchema,
	type ProviderAdapter,
	QuotaUnitSpecSchema,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for provider.chat@2 (docs/06 provider types, docs/09 Provider adapter).

/** What the fake endpoint behind the adapter does: answer with text, or a 429. */
export type ProviderScenario = "ok" | "rate-limited";

/**
 * Opens an adapter wired to a fake endpoint for one scenario; the provider's own
 * test writes the fake in its wire format, so no test reaches a real provider.
 * "ok" answers every chat with some text and lists at least one model.
 */
export type ProviderChatHarness = (scenario: ProviderScenario) => Promise<{
	readonly adapter: ProviderAdapter;
	readonly model: string;
	readonly close: () => Promise<void>;
}>;

const collect = async (chunks: AsyncIterable<ChatChunk>) => {
	const out: ChatChunk[] = [];
	for await (const c of chunks) out.push(c);
	return out;
};

const terminal = (c: ChatChunk) => c.type === "finish" || c.type === "error";

/** Every provider.chat@2 adapter MUST pass these tests. */
export const providerChatContract = (name: string, open: ProviderChatHarness) =>
	describe(`provider.chat@2 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const fresh = async (scenario: ProviderScenario) => {
			const h = await open(scenario);
			close = h.close;
			return h;
		};
		const chat = (
			h: Awaited<ReturnType<ProviderChatHarness>>,
			signal: AbortSignal,
		) =>
			collect(
				h.adapter.chat(
					{ model: h.model, messages: [{ role: "user", content: "hi" }] },
					signal,
				),
			);

		it("streams text and ends with exactly one finish as the last chunk", async () => {
			const h = await fresh("ok");
			const out = await chat(h, new AbortController().signal);
			expect(out.some((c) => c.type === "text")).toBe(true);
			expect(out.filter(terminal)).toHaveLength(1);
			expect(out.at(-1)?.type).toBe("finish");
		});

		it("ends a 429 with one rate_limited error chunk that keeps the status", async () => {
			const h = await fresh("rate-limited");
			const out = await chat(h, new AbortController().signal);
			expect(out).toHaveLength(1);
			const [only] = out;
			expect(only?.type).toBe("error");
			if (only?.type !== "error") return;
			expect(only.error.code).toBe("rate_limited");
			expect(only.error.status).toBe(429);
		});

		it("returns an aborted error chunk for an aborted signal", async () => {
			const h = await fresh("ok");
			const c = new AbortController();
			c.abort();
			const out = await chat(h, c.signal);
			expect(out).toHaveLength(1);
			expect(out[0]).toMatchObject({
				type: "error",
				error: { code: "aborted" },
			});
		});

		it("lists valid models and gives valid quota units and privacy", async () => {
			const h = await fresh("ok");
			const models = await h.adapter.listModels(new AbortController().signal);
			expect(models.ok).toBe(true);
			const list = models.ok ? models.value : [];
			expect(list.length).toBeGreaterThan(0);
			for (const m of list) {
				expect(ModelInfoSchema.parse(m).providerId).toBe(h.adapter.id);
				PrivacySchema.parse(h.adapter.privacy(m));
			}
			const units = h.adapter.quotaUnits();
			expect(units.length).toBeGreaterThan(0);
			for (const u of units)
				expect(QuotaUnitSpecSchema.parse(u).providerId).toBe(h.adapter.id);
		});
	});
