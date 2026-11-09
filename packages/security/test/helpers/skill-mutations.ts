import { ok, type SkillPreview } from "@mete/contracts";
import Database from "better-sqlite3";
import { afterEach } from "vitest";
import type { SkillMutationOptions } from "../../src/application/skill-mutation.js";
import { createSkillPreviews } from "../../src/application/skill-previews.js";
import {
	createSkillTrustStore,
	SKILL_TRUST_MIGRATIONS,
} from "../../src/infrastructure/skill-trust-store.js";
import { skillFixture } from "./skill-readers.js";

const databases: Database.Database[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});
/** Real SQLite grant/audit writes with native scripted readers and an explicit admission clock. */
export const mutationFixture = () => {
	const f = skillFixture();
	const db = new Database(":memory:");
	databases.push(db);
	for (const migration of SKILL_TRUST_MIGRATIONS) db.exec(migration.sql);
	const store = createSkillTrustStore(db);
	const workspaceKey = "d".repeat(64);
	const state: {
		active: boolean;
		now: number;
		admit: SkillMutationOptions["admit"];
	} = {
		active: true,
		now: 0,
		admit: async () => ({ admitted: true, result: ok(undefined) }),
	};
	const options: SkillMutationOptions = {
		...f.options,
		grants: {
			list: () => store.list(workspaceKey),
			read: (sourceId) => store.read(workspaceKey, sourceId),
		},
		update: (input) => store.update({ workspaceKey, ...input }),
		active: () => state.active,
		admit: (signal) => state.admit(signal),
		now: () => state.now,
	};
	const previews = createSkillPreviews(options);
	const prepare = async (): Promise<SkillPreview> => {
		const result = await previews.prepare(
			{ sourceId: f.inspection.source.sourceId },
			new AbortController().signal,
		);
		if (!result.ok) throw new Error("fixture preview failed");
		return result.value;
	};
	const seed = () =>
		options.update({
			source: f.inspection.source,
			sha256: f.inspection.sha256,
			enabled: true,
			expectedRevision: 0,
			at: new Date(0).toISOString(),
		});
	return { ...f, db, options, state, previews, prepare, seed };
};
