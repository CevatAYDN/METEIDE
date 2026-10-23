// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: security.
import { homedir } from "node:os";
import {
	err,
	type ModuleManifest,
	ok,
	type Policy,
	PolicySchema,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import type {
	Disposable,
	MeteModule,
	ModuleContext,
	ModuleError,
} from "@mete/kernel";
import {
	type AuditWriter,
	createPolicyCheck,
} from "./application/policy-check.js";
import {
	AUDIT_MIGRATIONS,
	createAuditWriter,
} from "./infrastructure/audit-log.js";
import { maskSecrets } from "./infrastructure/masker.js";

/** Folders and OS facts the policy needs; the composition root knows them. */
export type SecurityOptions = {
	readonly workspaceDir: string;
	readonly globalDir: string;
	/** The workspace the policy.blocked events name (docs/07). */
	readonly workspaceId: string;
	readonly home?: string;
	readonly platform?: NodeJS.Platform;
	readonly now?: () => number;
};

// policy.blocked (docs/07) follows each denial once its audit row is written; a write that throws
// publishes nothing, since the caller then gets audit_failed.
const announcingDenials =
	(
		write: AuditWriter,
		ctx: ModuleContext,
		workspaceId: string,
		now: () => number,
	): AuditWriter =>
	(row) => {
		write(row);
		if (row.verdict !== "deny") return;
		ctx.events.publish({
			id: crypto.randomUUID(),
			ts: new Date(now()).toISOString(),
			schema: 1,
			workspaceId,
			...(row.runId === null ? {} : { runId: row.runId }),
			...(row.agentId === null ? {} : { agentId: row.agentId }),
			source: MANIFEST.id,
			type: "policy.blocked",
			payload: { action: row.action, rule: row.rule },
		});
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

// policy.check@1 over the read policy, writing to the workspace audit log.
const checkerOf = (
	opts: SecurityOptions,
	ctx: ModuleContext,
	policy: Policy,
	db: Parameters<typeof createAuditWriter>[0],
) => {
	const env = {
		policy,
		workspaceDir: opts.workspaceDir,
		globalDir: opts.globalDir,
		home: opts.home ?? homedir(),
		platform: opts.platform ?? process.platform,
	};
	const now = opts.now ?? Date.now;
	const write = announcingDenials(
		createAuditWriter(db),
		ctx,
		opts.workspaceId,
		now,
	);
	return createPolicyCheck(env, write, now);
};

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
			const check = checkerOf(opts, ctx, policy.value, ctx.storage.workspace);
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
