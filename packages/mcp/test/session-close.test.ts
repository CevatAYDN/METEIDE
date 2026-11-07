import { describe, expect, it, vi } from "vitest";
import { trackSessionClose } from "../src/application/session-credentials.js";

describe("session shutdown completion", () => {
	it("shares and drains the original close even when abort and module shutdown race", async () => {
		const release = Promise.withResolvers<void>();
		const close = vi.fn(async () => {
			await release.promise;
		});
		const client = { close };
		const pending = new Set<Promise<void>>();
		trackSessionClose(client, pending);
		const aborted = client.close();
		const shutdown = client.close();
		expect(shutdown).toBe(aborted);
		expect(pending.size).toBe(1);
		await Promise.resolve();
		expect(close).toHaveBeenCalledOnce();
		let drained = false;
		const waiting = Promise.allSettled([...pending]).then(() => {
			drained = true;
		});
		await Promise.resolve();
		expect(drained).toBe(false);
		release.resolve();
		await waiting;
		expect(pending.size).toBe(0);
	});
});
