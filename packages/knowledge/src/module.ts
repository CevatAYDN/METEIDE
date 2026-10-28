// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: knowledge-graph, vault, knowledge-search.
import {
	type EventsReadAdapter,
	err,
	type MeteEvent,
	type ModuleManifest,
	ok,
	type ToolContext,
} from "@mete/contracts";
import type { MeteModule, ModuleContext } from "@mete/kernel";
import {
	readNote,
	type VaultDeps,
	writeNote,
} from "./application/vault-tools.js";
import { dayOf } from "./domain/journal-text.js";
import { factsOf, reportOf } from "./domain/run-report.js";
import { appendJournal } from "./infrastructure/journal.js";

/** The workspace the vault lives in; ids and clock are injectable for tests. */
export type VaultOptions = {
	readonly workspaceDir: string;
	readonly workspaceId: string;
	readonly newId?: () => string;
	readonly now?: () => number;
};

const MANIFEST: ModuleManifest = {
	id: "vault",
	version: "0.0.0",
	displayName: "Vault",
	class: "optional",
	trust: "core",
	provides: ["vault.read@1", "vault.write@1"],
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

const nowOf = (opts: VaultOptions) =>
	new Date((opts.now ?? Date.now)()).toISOString();

// vault.note.saved for a note written in this workspace.
const publishSaved = (
	ctx: ModuleContext,
	opts: VaultOptions,
	note: {
		readonly runId?: string;
		readonly path: string;
		readonly noteType: string;
	},
) =>
	ctx.events.publish({
		id: opts.newId?.() ?? crypto.randomUUID(),
		ts: nowOf(opts),
		schema: 1,
		workspaceId: opts.workspaceId,
		...(note.runId ? { runId: note.runId } : {}),
		source: MANIFEST.id,
		type: "vault.note.saved",
		payload: { path: note.path, noteType: note.noteType },
	});

// Writes one run's report; a report that cannot be written is logged and never fails anything.
const report = async (
	ctx: ModuleContext,
	opts: VaultOptions,
	end: MeteEvent,
) => {
	const runId = end.runId ?? "";
	const ended = new Date(end.ts);
	const section = sectionOf(ctx, runId, ended);
	const entry = { day: dayOf(ended), source: `run/${runId}` };
	const written = section.ok
		? await appendJournal(
				opts.workspaceDir,
				{ ...entry, section: section.value },
				nowOf(opts),
			)
		: section;
	if (!written.ok) {
		ctx.logger.error({ err: written.error, runId }, "run report not written");
		return;
	}
	publishSaved(ctx, opts, { runId, path: written.value, noteType: "journal" });
};

// One write at a time, run reports and the tools' notes alike: runs that end together (Stop all)
// would each read the day's note and write it back, and the last write would drop the others.
const serialQueue = () => {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(job: () => Promise<T>): Promise<T> => {
		const next = tail.then(job, job);
		tail = next.catch(() => undefined);
		return next;
	};
};

const provideTools = (
	ctx: ModuleContext,
	opts: VaultOptions,
	serial: VaultDeps["serial"],
) => {
	const deps: VaultDeps = {
		registry: ctx.capabilities,
		serial,
		saved: (tc: ToolContext, path, noteType) =>
			publishSaved(ctx, opts, {
				...(tc.runId ? { runId: tc.runId } : {}),
				path,
				noteType,
			}),
		now: () => nowOf(opts),
	};
	for (const [ref, run] of [
		["vault.read@1", readNote(deps)],
		["vault.write@1", writeNote(deps)],
	] as const)
		ctx.disposables.add(
			ctx.capabilities.provide(ref, {
				id: MANIFEST.id,
				trust: "core",
				features: [],
				impl: { run },
			}),
		);
};

/** Creates the vault module: the vault tools, and each ended run's report in the workspace journal (docs/11). */
export const createVaultModule = (opts: VaultOptions): MeteModule => {
	const queued = new Map<string, () => void>();
	const serial = serialQueue();
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			provideTools(ctx, opts, serial);
			const start = (e: MeteEvent) => {
				queued.delete(e.runId ?? "");
				serial(() => report(ctx, opts, e)).catch((err) =>
					ctx.logger.error({ err, runId: e.runId }, "run report not written"),
				);
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
		// A stop right after a run ends still writes its report, and every write in flight lands.
		async deactivate() {
			for (const now of [...queued.values()]) now();
			await serial(async () => undefined);
		},
	};
};
