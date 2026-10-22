import { describe, expect, it } from "vitest";
import { parseManifest } from "../../src/domain/manifest.js";

const gateway = {
	id: "gateway",
	version: "0.1.0",
	displayName: "Gateway",
	class: "essential",
	trust: "core",
	provides: ["llm.chat@1", "llm.embed@1", "llm.rerank@1"],
	requires: ["quota.reserve@2", "secrets.mask@1", "provider.chat@2"],
	optional: ["provider.embed@1"],
	activation: [
		"onStartup",
		"onCapability:llm.chat@1",
		"onCommand:gateway.restart",
	],
	isolation: "in-process",
	permissions: ["net", "llm"],
};

describe("parseManifest", () => {
	it("accepts the gateway manifest from the catalog", () => {
		const r = parseManifest(gateway);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.provides).toContain("llm.chat@1");
	});

	it.each([
		["id", "Gateway"],
		["version", "1.0"],
		["class", "required"],
		["trust", "vendor"],
		["isolation", "thread"],
		["provides", ["llm.chat"]],
		["permissions", ["root"]],
		["activation", ["onBoot"]],
		["activation", ["onCapability:llm"]],
		["activation", ["onCommand:"]],
	])("rejects a bad %s", (field, value) => {
		const r = parseManifest({ ...gateway, [field]: value });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("invalid_manifest");
	});

	it("requires third-party modules to run in their own process", () => {
		const plugin = { ...gateway, id: "some-plugin", trust: "third-party" };
		expect(parseManifest(plugin).ok).toBe(false);
		expect(parseManifest({ ...plugin, isolation: "process" }).ok).toBe(true);
	});

	it("rejects unknown fields", () => {
		expect(parseManifest({ ...gateway, main: "index.js" }).ok).toBe(false);
	});
});
