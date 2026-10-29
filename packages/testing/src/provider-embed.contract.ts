import { ModelInfoSchema, type ProviderAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderScenario } from "./provider-chat.contract.js";

// Contract kit for provider.embed@2 (docs/06 provider types, docs/09 Provider adapter, ADR-152).

/**
 * Opens an adapter wired to a fake endpoint for one scenario; the provider's own
 * test writes the fake in its wire format, so no test reaches a real provider.
 * "ok" lists `model` as an embedding model and embeds every input.
 */
export type ProviderEmbedHarness = (scenario: ProviderScenario) => Promise<{
	readonly adapter: ProviderAdapter;
	readonly model: string;
	readonly close: () => Promise<void>;
}>;

/** Every provider.embed@2 adapter MUST pass these tests. */
export const providerEmbedContract = (
	name: string,
	open: ProviderEmbedHarness,
) =>
	describe(`provider.embed@2 contract: ${name}`, () => {
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
		const embed = (h: Awaited<ReturnType<ProviderEmbedHarness>>) =>
			h.adapter.embed?.(
				{ model: h.model, input: ["a cup", "a mug"], purpose: "document" },
				new AbortController().signal,
			);

		it("lists valid embedding models, among them the one it embeds with", async () => {
			const h = await fresh("ok");
			const models = await h.adapter.embedModels?.(
				new AbortController().signal,
			);
			expect(models?.ok).toBe(true);
			const list = models?.ok ? models.value : [];
			for (const m of list)
				expect(ModelInfoSchema.parse(m).providerId).toBe(h.adapter.id);
			expect(list.map((m) => m.id)).toContain(h.model);
		});

		it("returns one vector of finite numbers per input, all of one length", async () => {
			const h = await fresh("ok");
			const r = await embed(h);
			expect(r?.ok).toBe(true);
			const vectors = r?.ok ? r.value.vectors : [];
			expect(vectors).toHaveLength(2);
			const [first, second] = vectors;
			expect(first?.length).toBeGreaterThan(0);
			expect(second).toHaveLength(first?.length ?? -1);
			for (const v of vectors)
				expect(v.every((n) => Number.isFinite(n))).toBe(true);
		});

		it("answers a 429 with a rate_limited error that keeps the status", async () => {
			const h = await fresh("rate-limited");
			const r = await embed(h);
			expect(r?.ok).toBe(false);
			if (r === undefined || r.ok) return;
			expect(r.error.code).toBe("rate_limited");
			expect(r.error.status).toBe(429);
		});
	});
