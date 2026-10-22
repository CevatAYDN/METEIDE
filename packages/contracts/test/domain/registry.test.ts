import { describe, expect, it } from "vitest";
import {
	RegistryEntrySchema,
	RegistrySearchInputSchema,
} from "../../src/domain/registry.js";

const entry = {
	id: "io.github.example/files",
	kind: "mcp",
	version: "0.1.4",
	description: "Files",
	source: "pypi:files-mcp",
	runtime: "python",
	permissions: [],
};

describe("registry.search@1", () => {
	it("takes words and an optional kind", () => {
		expect(RegistrySearchInputSchema.parse({ query: " files " })).toEqual({
			query: "files",
		});
		for (const bad of [{ query: " " }, { query: "x", kind: "theme" }])
			expect(RegistrySearchInputSchema.safeParse(bad).success).toBe(false);
	});

	it("checks an entry; the hash is optional but must be a SHA-256 when given", () => {
		expect(RegistryEntrySchema.safeParse(entry).success).toBe(true);
		for (const bad of [
			{ ...entry, sha256: "abc" },
			{ ...entry, runtime: "java" },
			{ ...entry, permissions: ["root"] },
		])
			expect(RegistryEntrySchema.safeParse(bad).success).toBe(false);
	});
});
