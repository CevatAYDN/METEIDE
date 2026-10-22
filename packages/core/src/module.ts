// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: core-engine; autonomy comes later.
import { randomUUID } from "node:crypto";
import { release, type } from "node:os";
import { err, type ModuleManifest, ok } from "@mete/contracts";
import type { MeteModule, ModuleError } from "@mete/kernel";
import { createEngine, type EngineDeps } from "./application/engine.js";
import { createArtifactStore } from "./infrastructure/artifact-store.js";
import { createHandoffStore } from "./infrastructure/handoff-store.js";
import { createRunStore, RUN_MIGRATIONS } from "./infrastructure/run-store.js";
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
};

const MANIFEST: ModuleManifest = {
	id: "core-engine",
	version: "0.0.0",
	displayName: "Core engine",
	class: "essential",
	trust: "core",
	provides: ["team.engine@2"],
	requires: [
		"llm.chat@1",
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
	// fs.write: artifact files in .mete/artifacts/ (ARCHITECTURE.md, workspace files).
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

/** Creates core-engine, which provides team.engine@2 for single-agent and team runs. */
export const createCoreEngineModule = (opts: CoreEngineOptions): MeteModule => {
	let stop: (() => Promise<void>) | undefined;
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			if (!ctx.storage) return err(failed("storage.sql@1 was not provided"));
			const migrated = ctx.storage.migrate("workspace", RUN_MIGRATIONS);
			if (!migrated.ok) return err(failed(migrated.error.message));
			const created = createEngine({
				workspaceId: opts.workspaceId,
				registry: ctx.capabilities,
				events: ctx.events,
				config: ctx.config,
				logger: ctx.logger,
				store: createRunStore(ctx.storage.workspace),
				handoffs: createHandoffStore(ctx.storage.workspace),
				now: opts.now ?? Date.now,
				newId: randomUUID,
				setTimer: opts.setTimer ?? realTimer,
				os: `${type()} ${release()}`,
				platform: process.platform,
				templates: opts.templates,
				artifacts: opts.workspaceDir
					? createArtifactStore(opts.workspaceDir)
					: undefined,
			});
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
			return ok(undefined);
		},
		async deactivate() {
			await stop?.();
			stop = undefined;
		},
	};
};
