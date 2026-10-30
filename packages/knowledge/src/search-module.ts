// The knowledge-search module (docs/06; ADR-149, ADR-152): knowledge.search@1 over a keyword index
// and the vectors of the workspace vault's notes, kept in the workspace database.
import { err, type ModuleManifest, ok } from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import { type EmbedJob, embedJob } from "./application/embed-job.js";
import { searchNotes } from "./application/search.js";
import {
	INDEX_MIGRATIONS,
	keywordIndex,
} from "./infrastructure/keyword-index.js";
import {
	VECTOR_MIGRATIONS,
	vectorIndex,
} from "./infrastructure/vector-index.js";

const MANIFEST: ModuleManifest = {
	id: "knowledge-search",
	version: "0.0.0",
	displayName: "Knowledge search",
	class: "optional",
	trust: "core",
	provides: ["knowledge.search@1"],
	requires: ["storage.sql@1", "fs.glob@1", "fs.read@1"],
	optional: ["llm.embed@1"],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["fs.read"],
};

const failed = (message: string) => ({
	code: "activation_failed" as const,
	moduleId: MANIFEST.id,
	message,
});

/** Creates the knowledge-search module; `now` is the clock a quota pause is read against. */
export const createKnowledgeSearchModule = (
	opts: { readonly now?: () => number } = {},
): MeteModule => {
	let job: EmbedJob | undefined;
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			if (!ctx.storage) return err(failed("storage.sql@1 was not provided"));
			const migrated = ctx.storage.migrate("workspace", [
				...INDEX_MIGRATIONS,
				...VECTOR_MIGRATIONS,
			]);
			if (!migrated.ok) return err(failed(migrated.error.message));
			const registry = ctx.capabilities;
			const index = keywordIndex(ctx.storage.workspace);
			const vectors = vectorIndex(ctx.storage.workspace);
			const now = opts.now ?? Date.now;
			const warn = (m: string) =>
				ctx.logger.warn({}, `embedding the vault: ${m}`);
			job = embedJob({ registry, index, vectors, now, warn });
			const run = searchNotes({ registry, index, vectors, job });
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
		// The index is written in synchronous transactions; only the background embedding is in flight.
		async deactivate() {
			job?.stop();
		},
	};
};
