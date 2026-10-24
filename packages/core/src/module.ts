// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: core-engine; autonomy comes later.
import { randomUUID } from "node:crypto";
import { release, type } from "node:os";
import { err, type ModuleManifest, ok } from "@mete/contracts";
import type { MeteModule, ModuleContext, ModuleError } from "@mete/kernel";
import { createEngine, type EngineDeps } from "./application/engine.js";
import { createArtifactStore } from "./infrastructure/artifact-store.js";
import { createHandoffStore } from "./infrastructure/handoff-store.js";
import { createRunStore, RUN_MIGRATIONS } from "./infrastructure/run-store.js";
import { createSnapshotStore } from "./infrastructure/snapshot-store.js";
import type { TemplateDirs } from "./infrastructure/template-store.js";

/** What the composition root passes; clock and timer are injectable for tests. */
export type CoreEngineOptions = {
	readonly workspaceId: string;
	readonly now?: () => number;
	readonly setTimer?: EngineDeps["setTimer"];
	/** Pause runs an earlier process left running (docs/07); off for a process that only reads runs. */
	readonly recover?: boolean;
	/** The built-in templates/ folder and the workspace root; without them team runs are refused. */
	readonly templates?: TemplateDirs;
	/** The workspace root; team runs write their artifacts to its .mete/artifacts/. */
	readonly workspaceDir?: string;
	/** The global snapshots/ folder, for file snapshots where the workspace has no git (ADR-080). */
	readonly snapshotsDir?: string;
};

const MANIFEST: ModuleManifest = {
	id: "core-engine",
	version: "0.0.0",
	displayName: "Core engine",
	class: "essential",
	trust: "core",
	provides: ["team.engine@2", "checkpoint.restore@1"],
	requires: [
		"llm.chat@2",
		"fs.read@1",
		"fs.write@1",
		"fs.edit@1",
		"fs.list@1",
		"fs.glob@1",
		"fs.grep@1",
		"policy.check@1",
		"secrets.mask@1",
		"storage.sql@1",
	],
	optional: [
		"shell.exec@1",
		"vcs.git@2",
		"web.fetch@1",
		"web.search@1",
		"mcp.tools@1",
	],
	activation: ["onStartup"],
	isolation: "in-process",
	// fs.write: artifact files in .mete/artifacts/ (ARCHITECTURE.md, workspace files), and file snapshots in
	// the global snapshots/ folder and their restore into the workspace (ADR-080).
	permissions: ["llm", "fs.write"],
};

const failed = (message: string): ModuleError => ({
	code: "activation_failed",
	moduleId: MANIFEST.id,
	message,
});

// setTimeout fires at once above 2^31 - 1 ms; the engine clamps its delays to that.
const realTimer: EngineDeps["setTimer"] = (fn, ms) => {
	const t = setTimeout(fn, ms);
	return () => clearTimeout(t);
};

// The engine's dependencies from the module context and the workspace database.
const depsOf = (
	opts: CoreEngineOptions,
	ctx: ModuleContext,
	db: Parameters<typeof createRunStore>[0],
): EngineDeps => ({
	workspaceId: opts.workspaceId,
	registry: ctx.capabilities,
	events: ctx.events,
	config: ctx.config,
	logger: ctx.logger,
	store: createRunStore(db),
	handoffs: createHandoffStore(db),
	now: opts.now ?? Date.now,
	newId: randomUUID,
	setTimer: opts.setTimer ?? realTimer,
	os: `${type()} ${release()}`,
	platform: process.platform,
	templates: opts.templates,
	artifacts: opts.workspaceDir
		? createArtifactStore(opts.workspaceDir)
		: undefined,
	snapshots:
		opts.workspaceDir && opts.snapshotsDir
			? createSnapshotStore(opts.snapshotsDir, opts.workspaceDir)
			: undefined,
});

/** Creates core-engine, which provides team.engine@2 for single-agent and team runs and checkpoint.restore@1. */
export const createCoreEngineModule = (opts: CoreEngineOptions): MeteModule => {
	let stop: (() => Promise<void>) | undefined;
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			if (!ctx.storage) return err(failed("storage.sql@1 was not provided"));
			const migrated = ctx.storage.migrate("workspace", RUN_MIGRATIONS);
			if (!migrated.ok) return err(failed(migrated.error.message));
			const created = createEngine(depsOf(opts, ctx, ctx.storage.workspace));
			if (opts.recover !== false) created.recover();
			stop = created.stop;
			ctx.disposables.add(
				ctx.capabilities.provide("team.engine@2", {
					id: MANIFEST.id,
					trust: "core",
					features: [],
					impl: created.engine,
				}),
			);
			ctx.disposables.add(
				ctx.capabilities.provide("checkpoint.restore@1", {
					id: MANIFEST.id,
					trust: "core",
					features: [],
					impl: created.restore,
				}),
			);
			return ok(undefined);
		},
		async deactivate() {
			await stop?.();
			stop = undefined;
		},
	};
};
