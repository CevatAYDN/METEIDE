// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: tools-fs, tools-shell, tools-web, vcs-git, browser.
import { join } from "node:path";
import {
	type CapabilityRef,
	type ModuleManifest,
	ok,
	type PolicyCheckAdapter,
	type Result,
	type ToolAdapter,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import type { CapabilityRegistry, MeteModule } from "@mete/kernel";
import type { FsDeps } from "./application/fs-common.js";
import {
	globTool,
	grepTool,
	listTool,
	readFileTool,
} from "./application/fs-read.js";
import { editTool, writeTool } from "./application/fs-write.js";
import { realTarget } from "./infrastructure/files.js";

/** Where the workspace and the global data folder are; the composition root passes them. */
export type ToolsOptions = {
	readonly workspaceDir: string;
	readonly globalDir: string;
};

const FS_MANIFEST: ModuleManifest = {
	id: "tools-fs",
	version: "0.0.0",
	displayName: "File tools",
	class: "essential",
	trust: "core",
	provides: [
		"fs.read@1",
		"fs.write@1",
		"fs.edit@1",
		"fs.list@1",
		"fs.glob@1",
		"fs.grep@1",
	],
	requires: ["policy.check@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["fs.read", "fs.write"],
};

type Run = (
	deps: FsDeps,
	input: unknown,
	ctx: ToolContext,
) => Promise<Result<unknown, ToolError>>;

const FS_TOOLS: readonly (readonly [CapabilityRef, Run])[] = [
	["fs.read@1", readFileTool],
	["fs.write@1", writeTool],
	["fs.edit@1", editTool],
	["fs.list@1", listTool],
	["fs.glob@1", globTool],
	["fs.grep@1", grepTool],
];

/** The registry's current policy.check@1, or none. */
export const policyOf =
	(registry: CapabilityRegistry) => (): PolicyCheckAdapter | undefined => {
		const r = registry.resolve<PolicyCheckAdapter>("policy.check@1");
		return r.ok ? r.value[0].impl : undefined;
	};

/** The tools-fs module: fs.read, write, edit, list, glob and grep (docs/10). */
export const createToolsFsModule = (opts: ToolsOptions): MeteModule => ({
	manifest: FS_MANIFEST,
	async activate(ctx) {
		const deps: FsDeps = {
			adapterId: FS_MANIFEST.id,
			// Real paths, so boundary checks compare like with like after symbolic links.
			workspaceDir: await realTarget(opts.workspaceDir),
			worktreesDir: await realTarget(join(opts.globalDir, "worktrees")),
			policy: policyOf(ctx.capabilities),
		};
		for (const [ref, run] of FS_TOOLS) {
			const impl: ToolAdapter<unknown, unknown> = {
				run: (input, c) => run(deps, input, c),
			};
			ctx.disposables.add(
				ctx.capabilities.provide(ref, {
					id: FS_MANIFEST.id,
					trust: "core",
					features: [],
					impl,
				}),
			);
		}
		return ok(undefined);
	},
	async deactivate() {},
});
