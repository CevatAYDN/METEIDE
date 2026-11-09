import type {
	ConversationCapability,
	DaemonSkillsRuntimeResult,
	Result,
	SkillPolicy,
	SkillRuntimeCatalog,
} from "@mete/contracts";
import type { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { createElement } from "react";
import {
	type ChainContext,
	type ComposerOption,
	loadRoles,
	optionsOf,
	singleAgentModels,
} from "../application/composer.js";
import { contextScope } from "../application/context-drafts.js";
import { ConversationTools } from "../application/conversation-tools.js";
import {
	changeSkillMode,
	SkillSelectionControl,
	toggleSelectedSkill,
} from "../application/skill-selection.js";
import { failureText } from "../application/status-text.js";
import type { DaemonFailure } from "../domain/daemon-failure.js";
import type { MeteDaemonService } from "../domain/status-service.js";
import type { MeteEditorContext } from "./editor-context-service.js";

/** Normalize the daemon runtime catalog response into a session and safe catalog state. */
export const runtimeCatalogOf = (
	runtime: Result<DaemonSkillsRuntimeResult, DaemonFailure> | undefined,
): {
	readonly sessionId?: string | undefined;
	readonly catalog?: SkillRuntimeCatalog | undefined;
} => {
	if (!runtime) return {};
	if (runtime.ok) {
		if (runtime.value.ok) return runtime.value.value;
		return {
			catalog: {
				status: "unavailable",
				entries: [],
				diagnostics: [runtime.value.error],
			},
		};
	}
	return {
		catalog: {
			status: "unavailable",
			entries: [],
			diagnostics: [{ code: "unavailable" }],
		},
	};
};

/** Display the same scoped draft that admission uses, including after a late success. */
export const composerContext = (
	workspace: WorkspaceService,
	dir: string | undefined,
	context: MeteEditorContext | undefined,
	goal: string,
) => {
	const current =
		!workspace.tryGetRoots ||
		workspace.tryGetRoots()[0]?.resource.path.fsPath() === dir;
	const scope = dir ? contextScope(dir) : undefined;
	const draft = scope ? context?.drafts.read(scope) : undefined;
	return {
		current,
		scope,
		preparing: draft?.busy === true,
		goal: current ? (draft?.message ?? goal) : "",
	};
};

/** Loads templates, estimates and uncommitted count for one open folder. */
export const loadComposerOptions = async (
	daemon: MeteDaemonService,
	dir: string,
	cache: Map<string, readonly string[]>,
): Promise<{
	readonly options: readonly ComposerOption[];
	readonly uncommitted: number | undefined;
	readonly loadError: string | undefined;
}> => {
	const failures: DaemonFailure[] = [];
	const listed = await daemon.templates(dir);
	if (!listed.ok) failures.push(listed.error);
	const raw = listed.ok ? listed.value.templates : [];
	const ctx: ChainContext = {
		daemon,
		dir,
		cache,
		failed: (why) => failures.push(why),
	};
	const [templates, singleModels, changes, ...estimates] = await Promise.all([
		loadRoles(ctx, raw),
		singleAgentModels(ctx),
		daemon.changes(dir),
		...[...raw.map((t) => t.id), null].map((id) => daemon.estimate(dir, id)),
	]);
	if (!changes.ok) failures.push(changes.error);
	return {
		options: optionsOf(templates, estimates, singleModels),
		uncommitted: changes.ok ? changes.value.files.length : undefined,
		loadError: failures[0] ? failureText(failures[0]) : undefined,
	};
};

/** Single-agent tool and skill controls; hidden when a team option is selected. */
export const singleAgentControls = (deps: {
	readonly selected: string;
	readonly busy: boolean;
	readonly capabilities: readonly ConversationCapability[];
	readonly skills: SkillPolicy;
	readonly catalog: SkillRuntimeCatalog | undefined;
	readonly onTools: (selection: readonly ConversationCapability[]) => void;
	readonly onSkills: (skills: SkillPolicy) => void;
}) => {
	if (deps.selected !== "single") return {};
	return {
		tools: createElement(ConversationTools, {
			capabilities: deps.capabilities,
			disabled: deps.busy,
			onChange: (selection) => !deps.busy && deps.onTools(selection),
		}),
		skills: createElement(SkillSelectionControl, {
			policy: deps.skills,
			catalog: deps.catalog,
			disabled: deps.busy,
			onMode: (mode) =>
				!deps.busy && deps.onSkills(changeSkillMode(deps.skills, mode)),
			onToggle: (version, checked) =>
				!deps.busy &&
				deps.onSkills(toggleSelectedSkill(deps.skills, version, checked)),
		}),
	};
};
