import type {
	SkillCatalogAdapter,
	SkillSourceAdapter,
	SkillTrustAdapter,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { createSkillCatalogModule } from "@mete/mcp";
import {
	createSkillTrustModule,
	type SkillRuntimeAttestations,
} from "@mete/security";
import { createSkillSourceModule } from "@mete/tools";
import { admitSkillMutation } from "../application/skill-admission.js";
import type {
	NativeControlsView,
	NativeSkillLoads,
} from "../domain/native-controls.js";

/** Compose optional native ports without scanning, inference or startup installation. */
export const nativeSkillModules = (
	dirs: { workspaceDir: string; globalDir: string },
	workspaceId: string,
	registry: CapabilityRegistry,
	native: { view: NativeControlsView; skillLoads: NativeSkillLoads },
) => {
	const nativeSources = new WeakSet<SkillSourceAdapter>();
	const nativeCatalogs = new WeakSet<SkillCatalogAdapter>();
	const nativeTrust = new WeakSet<SkillTrustAdapter>();
	const modules = [
		createSkillSourceModule({
			...dirs,
			onAdapter: (adapter) => {
				nativeSources.add(adapter);
			},
		}),
		createSkillCatalogModule({
			nativeSources,
			onAdapter: (adapter) => {
				nativeCatalogs.add(adapter);
			},
		}),
		createSkillTrustModule({
			workspaceDir: dirs.workspaceDir,
			workspaceId,
			nativeSources,
			nativeCatalogs,
			admit: (signal) =>
				admitSkillMutation(
					{
						registry,
						workspaceDir: dirs.workspaceDir,
						nativeControls: native.view,
					},
					signal,
				),
			onAdapter: (adapter) => {
				nativeTrust.add(adapter);
			},
		}),
	];
	/** Security's S2 runtime receives the same native attestations (T1, ADR-190). */
	const attestations: SkillRuntimeAttestations = {
		nativeSources,
		nativeCatalogs,
		nativeTrust,
		admission: native.skillLoads,
	};
	return {
		modules,
		attestations,
		skillSourceAdapters: Object.freeze({
			has: (adapter: SkillSourceAdapter) => nativeSources.has(adapter),
		}),
		skillTrustAdapters: Object.freeze({
			has: (adapter: SkillTrustAdapter) => nativeTrust.has(adapter),
		}),
	};
};
