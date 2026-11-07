import {
	err,
	ok,
	type PolicyCheckAdapter,
	type RegistrySearchAdapter,
} from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	prepareRegistry,
	searchRegistry,
} from "../src/application/daemon-registry.js";

describe("desktop registry discovery without an engine", () => {
	it("walks empty or failed adapters but never bypasses a refusal", async () => {
		const registry = createCapabilityRegistry(() => []);
		const run = vi.fn(async () => ok({ entries: [] }));
		registry.provide<RegistrySearchAdapter>("registry.search@1", {
			id: "first",
			trust: "core",
			features: [],
			impl: {
				run: async () =>
					err({ code: "denied", rule: "policy", message: "refused" }),
			},
		});
		registry.provide<RegistrySearchAdapter>("registry.search@1", {
			id: "second",
			trust: "core",
			features: [],
			impl: { run },
		});
		expect(await searchRegistry(registry, "docs")).toMatchObject({
			ok: false,
			error: { code: "denied" },
		});
		expect(run).not.toHaveBeenCalled();
	});
	it("prepares a pinned draft using the adapter without writing a file or calling a tool", async () => {
		const registry = createCapabilityRegistry(() => []);
		registry.provide<PolicyCheckAdapter>("policy.check@1", {
			id: "policy",
			trust: "core",
			features: [],
			impl: { check: () => ok({ verdict: "allow", rule: "test" }) },
		});
		const fetcher = vi.fn<typeof fetch>(
			async () =>
				new Response(
					JSON.stringify({
						server: {
							name: "org.example/docs",
							version: "1.2.3",
							packages: [
								{
									registryType: "npm",
									identifier: "example-docs-mcp",
									version: "1.2.3",
									environmentVariables: [{ name: "API_KEY", isRequired: true }],
								},
							],
						},
					}),
				),
		);
		const result = await prepareRegistry(registry, "org.example/docs", fetcher);
		expect(result).toMatchObject({
			ok: true,
			value: {
				source: "org.example/docs",
				server: { id: "docs", args: ["-y", "example-docs-mcp@1.2.3"] },
				notes: ["set the environment variable API_KEY under env"],
			},
		});
		expect(fetcher).toHaveBeenCalledOnce();
		expect(String(fetcher.mock.calls[0]?.[0])).toContain("org.example%2Fdocs");
	});
});
