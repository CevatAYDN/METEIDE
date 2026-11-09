import { createHash } from "node:crypto";
import {
	ok,
	type SkillInspection,
	type SkillSourceSnapshot,
	type SkillTrustAdapter,
	type StorageSqlAdapter,
} from "@mete/contracts";
import type { Disposable, MeteModule } from "@mete/kernel";
import { type SkillTrustHarness, skillTrustContract } from "@mete/testing";
import { expect } from "vitest";
import { createSkillTrustModule } from "../src/index.js";
import { skillFixture } from "./helpers/skill-readers.js";
import { setup } from "./setup.js";

const text = [
	"\ufeff---",
	"name: contract-trust",
	"description: secret",
	"license: secret",
	"compatibility: secret",
	"allowed-tools: secret",
	"metadata:",
	"  secret: secret",
	"---",
	"secret body",
	"",
].join("\r\n");
const maskedText = [
	"\ufeff---",
	"name: contract-trust",
	'description: "masked"',
	'license: "masked"',
	'compatibility: "masked"',
	'allowed-tools: "masked"',
	"metadata:",
	'  "masked": "masked"',
	"---",
	"masked body",
	"",
].join("\r\n");

const open: SkillTrustHarness = async () => {
	const base = await setup();
	let module: MeteModule | undefined;
	const registrations: Disposable[] = [];
	const close = async () => {
		try {
			await module?.deactivate();
		} finally {
			for (const registration of registrations.splice(0))
				registration.dispose();
			await base.storage.deactivate();
		}
	};
	try {
		const native = skillFixture();
		const sourceId = native.inspection.source.sourceId;
		const snapshot: SkillSourceSnapshot = {
			source: { sourceId, scope: "workspace", path: "contract-trust/SKILL.md" },
			text,
			sha256: createHash("sha256")
				.update(Buffer.from(text, "utf8"))
				.digest("hex"),
		};
		Object.assign(native.inspection.source, snapshot.source);
		native.inspection.text = text;
		native.inspection.sha256 = snapshot.sha256;
		native.inspection.metadata.name = "contract-trust";
		registrations.push(
			base.registry.provide("skill.source@1", native.adapters.source),
			base.registry.provide("skill.catalog@1", native.adapters.catalog),
			base.registry.provide("secrets.mask@1", native.adapters.masker),
		);
		const sql = base.registry.resolve<StorageSqlAdapter>("storage.sql@1");
		if (!sql.ok) throw new Error("Expected real SQLite storage");
		module = createSkillTrustModule({
			workspaceDir: base.dirs.workspaceDir,
			workspaceId: base.workspaceId,
			nativeSources: native.options.nativeSources,
			nativeCatalogs: native.options.nativeCatalogs,
			admit: async () => ({ admitted: true, result: ok(undefined) }),
			now: () => 0,
		});
		const ctx = {
			...base.ctx,
			storage: sql.value[0].impl.scopeFor("skills-trust"),
		};
		expect((await module.activate(ctx)).ok).toBe(true);
		const resolved = base.registry.resolve<SkillTrustAdapter>("skill.trust@1");
		if (!resolved.ok) throw new Error("Expected native trust adapter");
		const maskedInspection: SkillInspection = {
			...snapshot,
			source: { ...snapshot.source },
			text: maskedText,
			metadata: {
				name: "contract-trust",
				description: "masked",
				license: "masked",
				compatibility: "masked",
				"allowed-tools": "masked",
				metadata: { masked: "masked" },
			},
		};
		return {
			adapter: resolved.value[0].impl,
			sourceId,
			snapshot,
			maskedInspection,
			close,
		};
	} catch (error) {
		await close();
		throw error;
	}
};

skillTrustContract("native trust module with real SQLite", open);
