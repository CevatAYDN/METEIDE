import { err, ok } from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	nearSections,
	type VectorDeps,
} from "../src/application/vector-source.js";

// The vector source (docs/11, Hybrid search; ADR-152): a vector table that cannot be searched is said
// in the log and leaves the keyword source answering alone, without an error.

const embedder = {
	embed: async () =>
		ok({ model: { providerId: "p", modelId: "e" }, vectors: [[1, 0]] }),
};

const depsWith = (nearest: VectorDeps["vectors"]["nearest"]) => {
	const warn = vi.fn();
	const deps = {
		registry: {
			resolve: () => ok([{ impl: embedder }]),
		} as unknown as CapabilityRegistry,
		index: { chunks: () => [] },
		vectors: { latest: () => "p/e", nearest },
		job: { pauseUntil: () => undefined },
		warn,
	} as unknown as VectorDeps;
	return { deps, warn };
};

const query = { text: "listener", k: 8 } as Parameters<typeof nearSections>[1];
const ctx = { signal: new AbortController().signal };

describe("nearSections", () => {
	it("says why the vectors could not be searched, and finds nothing, so the keyword source answers", async () => {
		const { deps, warn } = depsWith(() => err("no such table"));
		expect(await nearSections(deps, query, ctx)).toEqual([]);
		expect(warn).toHaveBeenCalledWith(
			"searching the vault by meaning: no such table",
		);
	});

	it("says nothing when the search worked and found nothing", async () => {
		const { deps, warn } = depsWith(() => ok([]));
		expect(await nearSections(deps, query, ctx)).toEqual([]);
		expect(warn).not.toHaveBeenCalled();
	});
});
