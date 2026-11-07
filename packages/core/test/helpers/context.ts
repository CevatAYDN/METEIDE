import {
	type ContextDraft,
	type ContextSnapshot,
	type FsContextAdapter,
	ok,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import { expect } from "vitest";
import type { engineHarness } from "./engine.js";

/** Scripted source and mask boundaries, without touching disk or providers. */
export const contextPorts = (
	h: ReturnType<typeof engineHarness>,
	inspect: FsContextAdapter["inspect"] = async () => ok({ path: "src/a.ts" }),
	mask: SecretsMaskAdapter["mask"] = async (text) => ({ text, masked: 0 }),
) => {
	const source = h.registry.provide<FsContextAdapter>("fs.context@1", {
		id: "context-source",
		trust: "core",
		features: [],
		impl: { inspect },
	});
	const masking = h.registry.provide<SecretsMaskAdapter>("secrets.mask@1", {
		id: "context-mask",
		trust: "core",
		features: [],
		impl: { mask },
	});
	return { source, masking };
};

/** A marked unsaved selection, independently of source disk contents. */
export const draft: ContextDraft = {
	path: "./src/a.ts",
	content: "private-text",
	modified: true,
	range: { start: { line: 2, character: 1 }, end: { line: 2, character: 13 } },
};

/** Captures a preview through the public @2 port. */
export const preview = async (
	h: ReturnType<typeof engineHarness>,
	input: ContextDraft = draft,
): Promise<ContextSnapshot> => {
	const result = await h.threadContext.prepare(input);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("context preview unavailable");
	return result.value;
};
