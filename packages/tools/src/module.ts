// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: tools-fs, tools-shell, tools-web, vcs-git, browser.
import { join } from "node:path";
import {
	type CapabilityRef,
	err,
	type ModuleManifest,
	ok,
	type PolicyCheckAdapter,
	type Result,
	ShellConfigSchema,
	type ToolAdapter,
	type ToolContext,
	type ToolError,
	type VcsGitAdapter,
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
import { shellTool } from "./application/shell.js";
import { vcsTool } from "./application/vcs.js";
import { realTarget } from "./infrastructure/files.js";
import { repoRoot } from "./infrastructure/git.js";

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

const SHELL_MANIFEST: ModuleManifest = {
	id: "tools-shell",
	version: "0.0.0",
	displayName: "Shell tool",
	class: "essential",
	trust: "core",
	provides: ["shell.exec@1"],
	requires: ["policy.check@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["shell"],
};

/** The tools-shell module: shell.exec@1 (docs/10); reads the `shell:` settings section. */
export const createToolsShellModule = (opts: ToolsOptions): MeteModule => ({
	manifest: SHELL_MANIFEST,
	async activate(ctx) {
		const shell = ctx.config.get("shell", ShellConfigSchema);
		if (!shell.ok)
			return err({
				code: "activation_failed",
				moduleId: SHELL_MANIFEST.id,
				message: `${shell.error.file} ${shell.error.path}: ${shell.error.reason}`,
			});
		const deps = {
			adapterId: SHELL_MANIFEST.id,
			workspaceDir: await realTarget(opts.workspaceDir),
			worktreesDir: await realTarget(join(opts.globalDir, "worktrees")),
			policy: policyOf(ctx.capabilities),
			shell: shell.value,
		};
		const impl: ToolAdapter<unknown, unknown> = {
			run: (input, c) => shellTool(deps, input, c),
		};
		ctx.disposables.add(
			ctx.capabilities.provide("shell.exec@1", {
				id: SHELL_MANIFEST.id,
				trust: "core",
				features: [],
				impl,
			}),
		);
		return ok(undefined);
	},
	async deactivate() {},
});

const VCS_MANIFEST: ModuleManifest = {
	id: "vcs-git",
	version: "0.0.0",
	displayName: "Git",
	class: "optional",
	trust: "core",
	provides: ["vcs.git@2"],
	requires: ["policy.check@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["fs.read", "fs.write"],
};

/** The vcs-git module: vcs.git@2 (docs/10); without a repository or git it does not activate. */
export const createVcsGitModule = (opts: ToolsOptions): MeteModule => ({
	manifest: VCS_MANIFEST,
	async activate(ctx) {
		const workspaceDir = await realTarget(opts.workspaceDir);
		const root = await repoRoot(workspaceDir);
		if (!root.ok)
			return err({
				code: "activation_failed",
				moduleId: VCS_MANIFEST.id,
				message: root.error.message,
			});
		const deps = {
			adapterId: VCS_MANIFEST.id,
			workspaceDir,
			worktreesDir: await realTarget(join(opts.globalDir, "worktrees")),
			policy: policyOf(ctx.capabilities),
			root: root.value,
		};
		const impl: VcsGitAdapter = { run: (input, c) => vcsTool(deps, input, c) };
		ctx.disposables.add(
			ctx.capabilities.provide("vcs.git@2", {
				id: VCS_MANIFEST.id,
				trust: "core",
				features: [],
				impl,
			}),
		);
		return ok(undefined);
	},
	async deactivate() {},
});
