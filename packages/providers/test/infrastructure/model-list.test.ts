import { describe, expect, it } from "vitest";
import { listModelIds } from "../../src/infrastructure/model-list.js";

const URL_ = "https://provider.test/v1/models";
const signal = () => new AbortController().signal;
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

describe("listModelIds", () => {
	it("sends the key and returns the listed ids", async () => {
		let auth: string | null = null;
		const r = await listModelIds(URL_, "k", signal(), async (_u, init) => {
			auth = new Headers(init?.headers).get("authorization");
			return json({ object: "list", data: [{ id: "a" }, { id: "b" }] });
		});
		expect(r).toEqual({ ok: true, value: ["a", "b"] });
		expect(auth).toBe("Bearer k");
	});

	it("maps a status, an unexpected body, a failed fetch and an abort", async () => {
		const status = await listModelIds(URL_, "k", signal(), async () =>
			json({}, 401),
		);
		expect(!status.ok && [status.error.code, status.error.status]).toEqual([
			"unauthorized",
			401,
		]);
		const body = await listModelIds(URL_, "k", signal(), async () =>
			json({ models: [] }),
		);
		expect(!body.ok && body.error.code).toBe("server");
		const down = await listModelIds(URL_, "k", signal(), async () => {
			throw new TypeError("fetch failed");
		});
		expect(!down.ok && down.error.code).toBe("network");
		const c = new AbortController();
		c.abort();
		const aborted = await listModelIds(URL_, "k", c.signal, async () => {
			throw new DOMException("aborted", "AbortError");
		});
		expect(!aborted.ok && aborted.error.code).toBe("aborted");
	});
});
