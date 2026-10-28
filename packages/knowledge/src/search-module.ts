// The knowledge-search module (docs/06; ADR-149): knowledge.search@1 over a keyword index of the
// workspace vault's notes, kept in the workspace database.
import { err, type ModuleManifest, ok } from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import { searchNotes } from "./application/search.js";
import {
	INDEX_MIGRATIONS,
	keywordIndex,
} from "./infrastructure/keyword-index.js";

const MANIFEST: ModuleManifest = {
	id: "knowledge-search",
	version: "0.0.0",
	displayName: "Knowledge search",
	class: "optional",
	trust: "core",
	provides: ["knowledge.search@1"],
	requires: ["storage.sql@1", "fs.glob@1", "fs.read@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["fs.read"],
};

const failed = (message: string) => ({
	code: "activation_failed" as const,
	moduleId: MANIFEST.id,
	message,
});

/** Creates the knowledge-search module. */
export const createKnowledgeSearchModule = (): MeteModule => ({
	manifest: MANIFEST,
	async activate(ctx) {
		if (!ctx.storage) return err(failed("storage.sql@1 was not provided"));
		const migrated = ctx.storage.migrate("workspace", INDEX_MIGRATIONS);
		if (!migrated.ok) return err(failed(migrated.error.message));
		const run = searchNotes({
			registry: ctx.capabilities,
			index: keywordIndex(ctx.storage.workspace),
		});
		ctx.disposables.add(
			ctx.capabilities.provide("knowledge.search@1", {
				id: MANIFEST.id,
				trust: "core",
				features: [],
				impl: { run },
			}),
		);
		return ok(undefined);
	},
	// Each search writes the index in one synchronous transaction, so nothing is left in flight.
	async deactivate() {},
});
