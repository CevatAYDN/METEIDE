import type { SecretsMaskAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for secrets.mask@1 (docs/09, Privacy).

/** Opens a fresh adapter for one test; `close` releases it afterwards. */
export type SecretsMaskHarness = () => Promise<{
	readonly adapter: SecretsMaskAdapter;
	readonly close: () => Promise<void>;
}>;

// Built at runtime so no secret-shaped literal sits in the repository.
const token = () => `ghp_${"A1b2C3d4E5".repeat(3)}aBcDeF`;

/** Every secrets.mask@1 adapter MUST pass these tests. */
export const secretsMaskContract = (name: string, open: SecretsMaskHarness) =>
	describe(`secrets.mask@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const fresh = async () => {
			const h = await open();
			close = h.close;
			return h.adapter;
		};

		it("returns text without secrets unchanged", async () => {
			const adapter = await fresh();
			expect(await adapter.mask("plain words, no keys")).toEqual({
				text: "plain words, no keys",
				masked: 0,
			});
		});

		it("replaces a token with [SECRET:<8 hex>] and counts it", async () => {
			const adapter = await fresh();
			const r = await adapter.mask(`token=${token()} end`);
			expect(r.masked).toBe(1);
			expect(r.text).toMatch(/^token=\[SECRET:[0-9a-f]{8}\] end$/);
		});
	});
