// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: knowledge-graph, vault, knowledge-search.
import {
	type EventsReadAdapter,
	err,
	type MeteEvent,
	type ModuleManifest,
	ok,
} from "@mete/contracts";
import type { MeteModule, ModuleContext } from "@mete/kernel";
import { factsOf, reportOf } from "./domain/run-report.js";
import { appendJournal, dayOf } from "./infrastructure/journal.js";

/** The workspace the vault lives in; ids and clock are injectable for tests. */
export type VaultOptions = {
	readonly workspaceDir: string;
	readonly workspaceId: string;
	readonly newId?: () => string;
	readonly now?: () => number;
};

// vault.read@1 and vault.write@1 come with their shapes (ADR-144's next slice); until then the
// module writes run reports only.
const MANIFEST: ModuleManifest = {
	id: "vault",
	version: "0.0.0",
	displayName: "Vault",
	class: "optional",
	trust: "core",
	provides: [],
	requires: ["fs.read@1", "fs.write@1", "events.read@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["fs.read", "fs.write"],
};

const ENDED = new Set<string>(["run.completed", "run.failed", "run.cancelled"]);

// The run's section, or why its events could not be read (a closed database throws).
const sectionOf = (ctx: ModuleContext, runId: string, ended: Date) => {
	const reader = ctx.capabilities.resolve<EventsReadAdapter>("events.read@1");
	if (!reader.ok) return err(reader.error);
	try {
		const { events } = reader.value[0].impl.read(runId);
		const at = `${dayOf(ended)} ${ended.toTimeString().slice(0, 5)}`;
		return ok(reportOf(runId, at, factsOf(events)));
	} catch (e) {
		return err(e);
	}
};

// Writes one run's report; a report that cannot be written is logged and never fails anything.
const report = async (
	ctx: ModuleContext,
	opts: VaultOptions,
	end: MeteEvent,
) => {
	const runId = end.runId ?? "";
	const ended = new Date(end.ts);
	const section = sectionOf(ctx, runId, ended);
	const now = new Date((opts.now ?? Date.now)()).toISOString();
	const written = section.ok
		? await appendJournal(
				opts.workspaceDir,
				{ day: dayOf(ended), runId, section: section.value },
				now,
			)
		: section;
	if (!written.ok) {
		ctx.logger.error({ err: written.error, runId }, "run report not written");
		return;
	}
	ctx.events.publish({
		id: opts.newId?.() ?? crypto.randomUUID(),
		ts: now,
		schema: 1,
		workspaceId: opts.workspaceId,
		runId,
		source: MANIFEST.id,
		type: "vault.note.saved",
		payload: { path: written.value, noteType: "journal" },
	});
};

/** Creates the vault module: each ended run leaves its report in the workspace journal (docs/11). */
export const createVaultModule = (opts: VaultOptions): MeteModule => {
	const queued = new Map<string, () => void>();
	const writing = new Set<Promise<void>>();
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			const start = (e: MeteEvent) => {
				queued.delete(e.runId ?? "");
				const p = report(ctx, opts, e)
					.catch((err) =>
						ctx.logger.error({ err, runId: e.runId }, "run report not written"),
					)
					.finally(() => writing.delete(p));
				writing.add(p);
			};
			// The handoff is published right after the ending event, in the same call (docs/08), so the
			// report waits one turn of the event loop to read it back.
			const handler = (e: MeteEvent) => {
				if (!ENDED.has(e.type) || !e.runId) return;
				const timer = setImmediate(() => start(e));
				queued.set(e.runId, () => {
					clearImmediate(timer);
					start(e);
				});
			};
			ctx.disposables.add(ctx.events.subscribe("run.*", handler));
			return ok(undefined);
		},
		// A stop right after a run ends still writes its report.
		async deactivate() {
			for (const now of [...queued.values()]) now();
			await Promise.all(writing);
		},
	};
};
