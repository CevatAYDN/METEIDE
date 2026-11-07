import { describe, expect, it } from "vitest";
import {
	DaemonRegistryPrepareResultSchema,
	DaemonRegistrySearchParamsSchema,
	DaemonRegistrySearchResultSchema,
} from "../../src/domain/daemon-registry.js";

describe("protocol 29 registry discovery", () => {
	it("requires a real query and validates every returned entry", () => {
		expect(
			DaemonRegistrySearchParamsSchema.safeParse({ query: " " }).success,
		).toBe(false);
		expect(
			DaemonRegistrySearchResultSchema.safeParse({
				entries: [{ id: "invented" }],
			}).success,
		).toBe(false);
		expect(DaemonRegistrySearchResultSchema.parse({ entries: [] })).toEqual({
			entries: [],
		});
	});
	it("prepares a validated server with explicit setup requirements, never installation success", () => {
		const result = {
			server: {
				id: "docs",
				transport: "streamable-http",
				url: "https://example.org/mcp",
				auth: "none",
				permissions: [],
			},
			notes: ["Requires an account"],
			source: "org.example/docs",
		};
		expect(DaemonRegistryPrepareResultSchema.parse(result)).toEqual(result);
		expect(
			DaemonRegistryPrepareResultSchema.safeParse({
				...result,
				installed: true,
			}).success,
		).toBe(false);
	});
});
