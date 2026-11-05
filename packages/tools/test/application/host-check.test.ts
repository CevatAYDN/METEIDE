import { describe, expect, it } from "vitest";
import {
	checkHost,
	resolvePublicAddress,
} from "../../src/application/host-check.js";

// The address a connection is pinned to (ADR-171): one of the name's public addresses, or why none.

const resolver = (names: Record<string, readonly string[] | Error>) => {
	const looked: string[] = [];
	const lookup = async (host: string) => {
		looked.push(host);
		const a = names[host] ?? ["93.184.216.34"];
		if (a instanceof Error) throw a;
		return a;
	};
	return { lookup, looked };
};

describe("resolvePublicAddress", () => {
	it("returns the first address of a name whose every address is public", async () => {
		const { lookup, looked } = resolver({
			"cdn.example": ["203.0.113.7", "203.0.113.8"],
		});
		const r = await resolvePublicAddress(lookup, "cdn.example");
		expect(r).toEqual({ ok: true, value: "203.0.113.7" });
		expect(looked).toEqual(["cdn.example"]);
	});

	it("refuses a name one of whose addresses is local, and one that answers no address", async () => {
		const { lookup } = resolver({
			"inside.example": ["203.0.113.7", "127.0.0.1"],
			"odd.example": ["not-an-address"],
		});
		const inside = await resolvePublicAddress(lookup, "inside.example");
		expect(inside.ok ? "ok" : inside.error).toMatchObject({
			code: "bad_input",
			message:
				"inside.example resolves to 127.0.0.1, which is not a public address",
		});
		const odd = await resolvePublicAddress(lookup, "odd.example");
		expect(odd.ok ? "ok" : odd.error.code).toBe("bad_input");
	});

	it("returns a literal address as it is without a lookup, and refuses a local one", async () => {
		const { lookup, looked } = resolver({});
		expect(await resolvePublicAddress(lookup, "[2001:db8::1]")).toEqual({
			ok: true,
			value: "2001:db8::1",
		});
		const local = await resolvePublicAddress(lookup, "127.0.0.1");
		expect(local.ok ? "ok" : local.error.code).toBe("bad_input");
		expect(looked).toEqual([]);
	});

	it("answers io for a name that does not resolve, as checkHost does", async () => {
		const { lookup } = resolver({
			"gone.example": new Error("getaddrinfo ENOTFOUND gone.example"),
			"empty.example": [],
		});
		const gone = await resolvePublicAddress(lookup, "gone.example");
		expect(gone.ok ? "ok" : gone.error.code).toBe("io");
		expect((await checkHost(lookup, "empty.example"))?.code).toBe("io");
		expect(await checkHost(lookup, "fine.example")).toBeUndefined();
	});
});
