import type { CapabilityRef } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	type Adapter,
	createCapabilityRegistry,
} from "../../src/domain/capability-registry.js";

const REF: CapabilityRef = "web.search@1";

const adapter = (
	id: string,
	trust: Adapter<string>["trust"] = "first-party",
	features: ReadonlyArray<string> = [],
): Adapter<string> => ({ id, trust, features, impl: id });

const ids = (
	r: ReturnType<ReturnType<typeof createCapabilityRegistry>["resolve"]>,
) => (r.ok ? r.value.map((a) => a.id) : r.error);

describe("createCapabilityRegistry", () => {
	it("returns CapabilityMissing for an empty chain", () => {
		const reg = createCapabilityRegistry(() => []);
		expect(reg.resolve(REF)).toEqual({
			ok: false,
			error: { code: "capability_missing", ref: REF },
		});
		expect(reg.has(REF)).toBe(false);
	});

	it("does not serve another major version", () => {
		const reg = createCapabilityRegistry(() => []);
		reg.provide("web.search@2", adapter("exa-mcp"));
		expect(reg.has(REF)).toBe(false);
		expect(reg.resolve(REF).ok).toBe(false);
	});

	it("orders bound adapters first, then by trust, then by registration", () => {
		const reg = createCapabilityRegistry(() => ["tavily", "gone", "exa-mcp"]);
		reg.provide(REF, adapter("plugin-a", "third-party"));
		reg.provide(REF, adapter("first-a", "first-party"));
		reg.provide(REF, adapter("exa-mcp", "third-party"));
		reg.provide(REF, adapter("core-a", "core"));
		reg.provide(REF, adapter("first-b", "first-party"));
		reg.provide(REF, adapter("tavily", "third-party"));
		expect(ids(reg.resolve(REF))).toEqual([
			"tavily",
			"exa-mcp",
			"core-a",
			"first-a",
			"first-b",
			"plugin-a",
		]);
	});

	it("removes adapters that lack a required feature", () => {
		const reg = createCapabilityRegistry(() => []);
		reg.provide(REF, adapter("plain"));
		reg.provide(REF, adapter("rich", "first-party", ["dates", "domains"]));
		expect(ids(reg.resolve(REF, ["domains", "dates"]))).toEqual(["rich"]);
		expect(ids(reg.resolve(REF, ["images"]))).toEqual({
			code: "capability_missing",
			ref: REF,
		});
	});

	it("drops an adapter on dispose; a second dispose is harmless", () => {
		const reg = createCapabilityRegistry(() => []);
		const sub = reg.provide(REF, adapter("exa-mcp"));
		reg.provide(REF, adapter("tavily"));
		sub.dispose();
		sub.dispose();
		expect(ids(reg.resolve(REF))).toEqual(["tavily"]);
		expect(reg.has(REF)).toBe(true);
	});

	it("throws when one adapter id provides the same capability twice", () => {
		const reg = createCapabilityRegistry(() => []);
		reg.provide(REF, adapter("exa-mcp"));
		expect(() => reg.provide(REF, adapter("exa-mcp"))).toThrow(/exa-mcp/);
	});
});
