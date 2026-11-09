import type {
	SkillCatalogAdapter,
	SkillSourceAdapter,
	SkillTrustAdapter,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { createSkillCatalogModule } from "@mete/mcp";
import { createSkillTrustModule } from "@mete/security";
import { createSkillSourceModule } from "@mete/tools";
import { admitSkillMutation } from "../application/skill-admission.js";
import type { NativeControlsView } from "../domain/native-controls.js";

/** Compose optional native ports without scanning, inference or startup installation. */
export const nativeSkillModules = (
	dirs: { workspaceDir: string; globalDir: string },
	workspaceId: string,
	registry: CapabilityRegistry,
	nativeControls: NativeControlsView,
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
					{ registry, workspaceDir: dirs.workspaceDir, nativeControls },
					signal,
				),
			onAdapter: (adapter) => {
				nativeTrust.add(adapter);
			},
		}),
	];
	return {
		modules,
		skillSourceAdapters: Object.freeze({
			has: (adapter: SkillSourceAdapter) => nativeSources.has(adapter),
		}),
		skillTrustAdapters: Object.freeze({
			has: (adapter: SkillTrustAdapter) => nativeTrust.has(adapter),
		}),
	};
};
