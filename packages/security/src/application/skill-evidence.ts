import { isDeepStrictEqual } from "node:util";
import {
	ok,
	SkillCatalogListSchema,
	type SkillError,
	SkillInspectionSchema,
	type SkillSourceDescriptor,
	SkillSourceListSchema,
	SkillSourceSnapshotSchema,
} from "@mete/contracts";
import { z } from "zod";
import { callSkill, type SkillReaders, skillFailure } from "./skill-readers.js";

const InventorySchema = z.strictObject({
	sources: SkillSourceListSchema,
	catalog: SkillCatalogListSchema,
});
/** Complete, directly validated source/catalog inventories from one captured operation. */
export type SkillInventory = z.infer<typeof InventorySchema>;

const blocksInventory = (diagnostic: SkillError) =>
	diagnostic.location === "root" ||
	(diagnostic.sourceId === undefined &&
		(diagnostic.code !== "bad_input" || diagnostic.location === undefined));

const validateInventoryIdentities = (inventory: SkillInventory) => {
	const { sources, catalog } = inventory;
	const known = new Map(sources.sources.map((s) => [s.sourceId, s]));
	// Native exclusions attest identity, not a readable/eligible descriptor.
	const attested = new Set(known.keys());
	for (const diagnostic of sources.diagnostics) {
		if (diagnostic.sourceId !== undefined) attested.add(diagnostic.sourceId);
	}
	if (
		catalog.diagnostics.some(
			(d) => d.sourceId !== undefined && !attested.has(d.sourceId),
		)
	)
		return skillFailure();
	if (
		catalog.entries.some(
			({ source }) => !isDeepStrictEqual(known.get(source.sourceId), source),
		)
	)
		return skillFailure("stale");
	return ok(inventory);
};
const validateInventory = (inventory: SkillInventory) => {
	const { sources, catalog } = inventory;
	const diagnostics = [...sources.diagnostics, ...catalog.diagnostics];
	if (
		!sources.complete ||
		!catalog.complete ||
		diagnostics.some(blocksInventory)
	) {
		return skillFailure(
			diagnostics.some(({ code }) => code === "limit_exceeded")
				? "limit_exceeded"
				: "unavailable",
		);
	}
	return validateInventoryIdentities(inventory);
};

/** Unreadable/partial inventories cannot assert absence or eligibility. */
export const readSkillInventory = (r: SkillReaders, signal: AbortSignal) =>
	callSkill(r, signal, InventorySchema, async () => {
		const sources = await callSkill(r, signal, SkillSourceListSchema, () =>
			r.source.list(signal),
		);
		if (!sources.ok) return sources;
		const catalog = await callSkill(r, signal, SkillCatalogListSchema, () =>
			r.catalog.list(signal),
		);
		if (!catalog.ok) return catalog;
		return validateInventory({
			sources: sources.value,
			catalog: catalog.value,
		});
	});

/** Direct native bytes must match catalog inspection; never trust a catalog digest alone. */
export const inspectCurrentSkill = (
	r: SkillReaders,
	source: SkillSourceDescriptor,
	signal: AbortSignal,
) =>
	callSkill(r, signal, SkillInspectionSchema, async () => {
		const input = { sourceId: source.sourceId };
		const raw = await callSkill(r, signal, SkillSourceSnapshotSchema, () =>
			r.source.read(input, signal),
		);
		if (!raw.ok) return raw;
		const inspected = await callSkill(r, signal, SkillInspectionSchema, () =>
			r.catalog.inspect(input, signal),
		);
		if (!inspected.ok) return inspected;
		if (
			!isDeepStrictEqual(raw.value.source, source) ||
			!isDeepStrictEqual(inspected.value.source, source) ||
			raw.value.sha256 !== inspected.value.sha256 ||
			raw.value.text !== inspected.value.text
		)
			return skillFailure("stale");
		return inspected;
	});
