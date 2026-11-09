import { randomUUID } from "node:crypto";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
	err,
	ok,
	type SkillTrustAdapter,
	type StorageSqlAdapter,
} from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import { afterEach, describe, expect, it } from "vitest";
import {
	createSkillTrustModule,
	type SkillTrustOptions,
} from "../src/index.js";
import { skillFixture } from "./helpers/skill-readers.js";
import { setup } from "./setup.js";

const modules: MeteModule[] = [];
const storage: MeteModule[] = [];
afterEach(async () => {
	for (const module of modules.splice(0).reverse()) await module.deactivate();
	for (const module of storage.splice(0)) await module.deactivate();
});
const fixture = async () => {
	const base = await setup();
	storage.push(base.storage);
	const native = skillFixture();
	Object.assign(native.inspection.source, { scope: "global" });
	base.registry.provide("skill.source@1", native.adapters.source);
	base.registry.provide("skill.catalog@1", native.adapters.catalog);
	base.registry.provide("secrets.mask@1", native.adapters.masker);
	const sql = base.registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) throw new Error("storage missing");
	const ctx = {
		...base.ctx,
		storage: sql.value[0].impl.scopeFor("skills-trust"),
	};
	const options: SkillTrustOptions = {
		workspaceDir: base.dirs.workspaceDir,
		workspaceId: base.workspaceId,
		nativeSources: native.options.nativeSources,
		nativeCatalogs: native.options.nativeCatalogs,
		admit: async () => ({ admitted: true, result: ok(undefined) }),
	};
	const start = async (overrides: Partial<SkillTrustOptions> = {}) => {
		const module = createSkillTrustModule({ ...options, ...overrides });
		modules.push(module);
		expect((await module.activate(ctx)).ok).toBe(true);
		const found = base.registry.resolve<SkillTrustAdapter>("skill.trust@1");
		if (!found.ok) throw new Error("trust missing");
		return { module, impl: found.value[0].impl };
	};
	return { base, native, ctx, options, start };
};
const signal = () => new AbortController().signal;

describe("optional native skill trust module", () => {
	it("attests the actual registered adapter and migrates only global storage without scanning", async () => {
		const f = await fixture();
		const attested = new WeakSet<SkillTrustAdapter>();
		let scans = 0;
		const list = f.native.adapters.source.impl.list;
		f.native.adapters.source.impl.list = (input) => {
			scans++;
			return list(input);
		};
		const started = await f.start({
			onAdapter: (impl) => {
				attested.add(impl);
			},
		});
		expect(started.module.manifest.class).toBe("optional");
		expect(attested.has(started.impl)).toBe(true);
		expect(scans).toBe(0);
		expect(
			f.ctx.storage.global
				.prepare(
					"SELECT module_id FROM storage_migrations WHERE id = '001-skill-trust'",
				)
				.pluck()
				.get(),
		).toBe("skills-trust");
		expect(
			f.ctx.storage.workspace
				.prepare(
					"SELECT name FROM sqlite_master WHERE name = 'skill_trust_grants'",
				)
				.get(),
		).toBeUndefined();
	});

	it("persists only for the same canonical folder and UUID, never a copied UUID alone", async () => {
		const f = await fixture();
		const first = await f.start();
		const sourceId = f.native.inspection.source.sourceId;
		const preview = await first.impl.prepare({ sourceId }, signal());
		if (!preview.ok) throw new Error("preview missing");
		expect(
			(
				await first.impl.approve(
					{ previewId: preview.value.previewId },
					signal(),
				)
			).result.ok,
		).toBe(true);
		const pending = await first.impl.prepare({ sourceId }, signal());
		if (!pending.ok) throw new Error("pending preview missing");
		await first.module.deactivate();
		expect((await first.impl.status(signal())).ok).toBe(false);
		const copied = join(f.base.dirs.workspaceDir, "copy");
		await mkdir(copied);
		for (const override of [
			{ workspaceDir: copied },
			{ workspaceId: randomUUID() },
		]) {
			const other = await f.start(override);
			expect(await other.impl.status(signal())).toMatchObject({
				ok: true,
				value: { entries: [{ status: "unapproved" }] },
			});
			await other.module.deactivate();
		}
		const alias = join(f.base.dirs.globalDir, "workspace-alias");
		await symlink(
			f.base.dirs.workspaceDir,
			alias,
			process.platform === "win32" ? "junction" : "dir",
		);
		const restored = await f.start({ workspaceDir: alias });
		expect(await restored.impl.status(signal())).toMatchObject({
			ok: true,
			value: { entries: [{ status: "approved" }] },
		});
		expect(
			(
				await restored.impl.approve(
					{ previewId: pending.value.previewId },
					signal(),
				)
			).admitted,
		).toBe(false);
		const keys = f.ctx.storage.global
			.prepare("SELECT workspace_key FROM skill_trust_grants")
			.pluck()
			.all();
		expect(keys).toHaveLength(1);
		expect(
			keys.every(
				(key) => typeof key === "string" && /^[a-f0-9]{64}$/u.test(key),
			),
		).toBe(true);
	});

	it("forwards a post-quiesce error receipt without writing or losing admission", async () => {
		const f = await fixture();
		const { impl } = await f.start({
			admit: async () => ({ admitted: true, result: err({ code: "stale" }) }),
		});
		const preview = await impl.prepare(
			{ sourceId: f.native.inspection.source.sourceId },
			signal(),
		);
		if (!preview.ok) throw new Error("preview missing");
		expect(
			await impl.approve({ previewId: preview.value.previewId }, signal()),
		).toEqual({
			admitted: true,
			result: { ok: false, error: { code: "stale" } },
		});
		expect(
			f.ctx.storage.global
				.prepare("SELECT COUNT(*) FROM skill_trust_grants")
				.pluck()
				.get(),
		).toBe(0);
	});

	it("cleans up registration when native attestation fails", async () => {
		const f = await fixture();
		const module = createSkillTrustModule({
			...f.options,
			onAdapter: () => {
				throw new Error("private callback details");
			},
		});
		modules.push(module);
		const result = await module.activate(f.ctx);
		expect(result.ok).toBe(false);
		expect(JSON.stringify(result)).not.toContain("private callback");
		expect(f.base.registry.has("skill.trust@1")).toBe(false);
	});
});
