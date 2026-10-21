// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: security.
import { homedir } from "node:os";
import {
	err,
	type ModuleManifest,
	ok,
	PolicySchema,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import type { Disposable, MeteModule, ModuleError } from "@mete/kernel";
import { createPolicyCheck } from "./application/policy-check.js";
import {
	AUDIT_MIGRATIONS,
	createAuditWriter,
} from "./infrastructure/audit-log.js";
import { maskSecrets } from "./infrastructure/masker.js";

/** Folders and OS facts the policy needs; the composition root knows them. */
export type SecurityOptions = {
	readonly workspaceDir: string;
	readonly globalDir: string;
	readonly home?: string;
	readonly platform?: NodeJS.Platform;
	readonly now?: () => number;
};

const MANIFEST: ModuleManifest = {
	id: "security",
	version: "0.0.0",
	displayName: "Security",
	class: "essential",
	trust: "core",
	provides: ["policy.check@1", "secrets.mask@1"],
	requires: ["storage.sql@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};

const failed = (message: string): ModuleError => ({
	code: "activation_failed",
	moduleId: MANIFEST.id,
	message,
});

const masker: SecretsMaskAdapter = { mask: maskSecrets };

// shortcut: the policy is read once at activation; reload it on a file watch when the desktop adds one.
/** Creates the security module, which provides policy.check@1 and secrets.mask@1. */
export const createSecurityModule = (opts: SecurityOptions): MeteModule => {
	let created: Disposable[] = [];
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			if (!ctx.storage) return err(failed("storage.sql@1 was not provided"));
			const migrated = ctx.storage.migrate("workspace", AUDIT_MIGRATIONS);
			if (!migrated.ok) return err(failed(migrated.error.message));
			const policy = ctx.config.get("policy", PolicySchema);
			if (!policy.ok) {
				const { file, path, reason } = policy.error;
				return err(failed(`${file} ${path}: ${reason}`));
			}
			const env = {
				policy: policy.value,
				workspaceDir: opts.workspaceDir,
				globalDir: opts.globalDir,
				home: opts.home ?? homedir(),
				platform: opts.platform ?? process.platform,
			};
			const check = createPolicyCheck(
				env,
				createAuditWriter(ctx.storage.workspace),
				opts.now,
			);
			const core = { id: MANIFEST.id, trust: "core", features: [] } as const;
			created = [
				ctx.capabilities.provide("policy.check@1", { ...core, impl: check }),
				ctx.capabilities.provide("secrets.mask@1", { ...core, impl: masker }),
			];
			for (const d of created) ctx.disposables.add(d);
			return ok(undefined);
		},
		async deactivate() {
			for (const d of created.splice(0)) d.dispose();
		},
	};
};
