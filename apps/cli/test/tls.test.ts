import { describe, expect, it } from "vitest";
import { TLS_KEY_EXCHANGE } from "../src/defaults.js";
import { preferHybridKeyExchange } from "../src/infrastructure/tls.js";

// The key exchange every TLS connection of the CLI and the daemon offers (ADR-160): the hybrid
// post-quantum group first when the runtime knows it, else the runtime's own default.

const runtime = (knows: boolean) => ({
	DEFAULT_ECDH_CURVE: "auto",
	createSecureContext: () => {
		if (!knows) throw new Error("Failed to set ECDH curve");
		return {};
	},
});

describe("preferHybridKeyExchange", () => {
	it("offers the hybrid group first, with the classic ones after it", () => {
		const tls = runtime(true);
		expect(preferHybridKeyExchange(tls)).toBe(true);
		expect(tls.DEFAULT_ECDH_CURVE).toBe(TLS_KEY_EXCHANGE);
		expect(TLS_KEY_EXCHANGE.split(":")).toEqual([
			"X25519MLKEM768",
			"X25519",
			"P-256",
			"P-384",
		]);
	});

	it("keeps the runtime's default where the runtime refuses the list", () => {
		const tls = runtime(false);
		expect(preferHybridKeyExchange(tls)).toBe(false);
		expect(tls.DEFAULT_ECDH_CURVE).toBe("auto");
	});
});
