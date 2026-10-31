import { describe, expect, it } from "vitest";
import { requestGate } from "../../src/application/host-check.js";

// A screenshot's page lets a request through only to a public host, or to the folder's own server (ADR-171).

const resolver = (names: Record<string, readonly string[]>) => {
	const looked: string[] = [];
	const lookup = async (host: string) => {
		looked.push(host);
		return names[host] ?? ["93.184.216.34"];
	};
	return { lookup, looked };
};

describe("requestGate", () => {
	it("refuses a host that resolves to a local address and looks each host up once", async () => {
		const { lookup, looked } = resolver({ "inside.example": ["127.0.0.1"] });
		const pass = requestGate(lookup, undefined);
		expect(await pass("https://cdn.example/a.css")).toBe(true);
		expect(await pass("https://cdn.example/b.js")).toBe(true);
		expect(await pass("https://inside.example/x")).toBe(false);
		expect(await pass("http://127.0.0.1:9000/")).toBe(false);
		expect(looked).toEqual(["cdn.example", "inside.example"]);
	});

	it("lets the folder's own server through without a lookup", async () => {
		const { lookup, looked } = resolver({});
		const pass = requestGate(lookup, "http://127.0.0.1:5123");
		expect(await pass("http://127.0.0.1:5123/index.html")).toBe(true);
		expect(await pass("http://127.0.0.1:5124/")).toBe(false);
		expect(looked).toEqual([]);
	});
});
