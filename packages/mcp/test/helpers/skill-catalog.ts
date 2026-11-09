import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
	err,
	ok,
	type SkillSourceAdapter,
	type SkillSourceDescriptor,
	type SkillSourceInput,
} from "@mete/contracts";
import { vi } from "vitest";
import { createSkillCatalog } from "../../src/application/skill-catalog.js";
import { moduleContext } from "./context.js";

export const hash = (text: string) =>
	createHash("sha256").update(text).digest("hex");
export const descriptor = (
	scope: "workspace" | "global",
	name = "example",
	sourceId = hash(scope),
): SkillSourceDescriptor => ({
	sourceId,
	scope,
	path: posix.join(name, "SKILL.md"),
});
export const snapshot = (source: SkillSourceDescriptor) => {
	const name = posix.basename(posix.dirname(source.path));
	const text = `---\nname: ${name}\ndescription: Local review\n---\nReview files.`;
	return { source, text, sha256: hash(text) };
};
export function setup(sources = [descriptor("workspace")], attested = true) {
	const { ctx, registry } = moduleContext("allow");
	const source: SkillSourceAdapter = {
		list: vi.fn(async () => ok({ sources, complete: true, diagnostics: [] })),
		read: vi.fn(async ({ sourceId }: SkillSourceInput) => {
			const found = sources.find((entry) => entry.sourceId === sourceId);
			return found ? ok(snapshot(found)) : err({ code: "not_found" as const });
		}),
	};
	const nativeSources = new WeakSet<SkillSourceAdapter>(
		attested ? [source] : [],
	);
	const adapter = {
		id: "native-source",
		trust: "core" as const,
		features: [],
		impl: source,
	};
	const registration = registry.provide("skill.source@1", adapter);
	const catalog = createSkillCatalog(registry, nativeSources);
	return {
		catalog,
		source,
		registration,
		registry,
		nativeSources,
		adapter,
		ctx,
	};
}
