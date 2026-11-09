import {
	ok,
	type SkillCatalogAdapter,
	type SkillSourceAdapter,
} from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";

/** In-process native attestations and mutable registry objects, without providers. */
export const skillFixture = () => {
	const registry = createCapabilityRegistry(() => []);
	const source = {
		sourceId: "a".repeat(64),
		scope: "workspace" as const,
		path: "secret/SKILL.md",
	};
	const inspection = {
		source,
		sha256: "b".repeat(64),
		text: "---\nname: secret\n---\nsecret body",
		metadata: {
			name: "secret",
			description: "secret",
			license: "secret",
			compatibility: "secret",
			"allowed-tools": "secret",
			metadata: { secret: "secret" },
		},
	};
	const sourceList = { sources: [source], complete: true, diagnostics: [] };
	const catalogList = {
		entries: [{ source, metadata: inspection.metadata }],
		complete: true,
		diagnostics: [],
	};
	const sourceImpl: SkillSourceAdapter = {
		list: async () => ok(sourceList),
		read: async () =>
			ok({ source, sha256: inspection.sha256, text: inspection.text }),
	};
	const catalogImpl: SkillCatalogAdapter = {
		list: async () => ok(catalogList),
		inspect: async () => ok(inspection),
	};
	const seen: string[] = [];
	const maskImpl = {
		mask: async (text: string) => {
			seen.push(text);
			return { text: text.replaceAll("secret", "masked"), masked: 1 };
		},
	};
	const base = { id: "native", trust: "core" as const, features: [] };
	const adapters = {
		source: { ...base, impl: sourceImpl },
		catalog: { ...base, impl: catalogImpl },
		masker: { ...base, impl: maskImpl },
	};
	const sourceRegistration = registry.provide(
		"skill.source@1",
		adapters.source,
	);
	registry.provide("skill.catalog@1", adapters.catalog);
	registry.provide("secrets.mask@1", adapters.masker);
	const options = {
		registry,
		nativeSources: new WeakSet([sourceImpl]),
		nativeCatalogs: new WeakSet([catalogImpl]),
	};
	return {
		options,
		adapters,
		sourceRegistration,
		inspection,
		sourceList,
		catalogList,
		seen,
	};
};
