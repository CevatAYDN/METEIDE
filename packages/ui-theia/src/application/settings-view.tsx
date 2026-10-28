import { nls } from "@theia/core/lib/common/nls";
import type { DaemonFailure, Settings } from "../domain/status-service.js";
import { SaveBar, type SaveEntry } from "./save-bar.js";
import { ScopeSwitch } from "./scope-switch.js";
import type { Target } from "./section-draft.js";
import {
	ApplyNow,
	type ApplyState,
	GroupHead,
	GroupList,
	Hero,
} from "./settings-frame.js";
import { type Group, type GroupId, groupsOf } from "./settings-groups.js";
import {
	type Bindings,
	cardParts,
	type Endpoints,
	type FormParts,
	type Forms,
	type Mcp,
	type Section,
	SectionCard,
	withForms,
} from "./settings-section.js";
import { failureText, noFolderText } from "./status-text.js";

// The Settings screen (docs/13, Settings; ADR-081 to ADR-087, ADR-095): the configuration the daemon
// loaded, each section merged and per file with the file's path, grouped in plain words in a list at
// the left. It leads to what Settings has elsewhere: the team editor, provider keys and Theia's
// preferences and language.

export type { ApplyState } from "./settings-frame.js";
export { SETTINGS_LINKS } from "./settings-groups.js";
export type { Bindings, Endpoints, Forms, Mcp } from "./settings-section.js";

/** What the screen draws. */
export type SettingsModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly failure: DaemonFailure }
	| { readonly kind: "settings"; readonly settings: Settings };

/** Where the screen's links go: a palette command by id, or a configuration file. */
export type SettingsActions = {
	readonly onApply: () => void;
	readonly onCommand: (id: string) => void;
	readonly onOpen: (file: string) => void;
	readonly onRefresh: () => void;
	/** The scope switch (ADR-095): every form saves to this target. */
	readonly onScope: (target: Target) => void;
	/** The save bar (ADR-095): every changed form saves. */
	readonly onSaveAll: () => void;
};

/** The group the screen shows, and the choice of another. */
export type GroupChoice = {
	readonly group: GroupId;
	readonly onGroup: (group: GroupId) => void;
};

// Everything the scope switch moves and the save bar saves (ADR-095, ADR-096): the forms, then the
// cards that follow them.
const saveablesOf = (
	forms: Forms,
	bindings?: Bindings | undefined,
	mcp?: Mcp | undefined,
): readonly SaveEntry[] => [
	...Object.entries(forms).flatMap(([name, form]) =>
		form ? [[name, form] as const] : [],
	),
	...(bindings ? [["bindings", bindings] as const] : []),
	...(mcp ? [["mcp", mcp] as const] : []),
];

// The chosen group: its heading, then its sections, each with its form or card.
const GroupBody = ({
	group,
	settings,
	actions,
	parts,
}: {
	readonly group: Group<Section>;
	readonly settings: Settings;
	readonly actions: SettingsActions;
	readonly parts: Omit<FormParts, "name" | "settings">;
}) => (
	<>
		<GroupHead group={group} onCommand={actions.onCommand} />
		{group.sections.map((s) => (
			<SectionCard
				key={s.name}
				section={s}
				onOpen={actions.onOpen}
				{...cardParts({ ...parts, name: s.name, settings })}
			/>
		))}
	</>
);

const Loaded = ({
	settings,
	actions,
	parts,
	apply,
	choice,
}: {
	readonly settings: Settings;
	readonly actions: SettingsActions;
	readonly parts: Omit<FormParts, "name" | "settings">;
	readonly apply: ApplyState;
	readonly choice: GroupChoice;
}) => {
	const groups = groupsOf(withForms(settings.sections));
	const chosen = groups.find((g) => g.id === choice.group) ?? groups[0];
	const scoped = saveablesOf(parts.forms, parts.bindings, parts.mcp);
	// The forms move together, so the first one tells where they all save.
	const target = scoped[0]?.[1].state.target;
	// The endpoints card keeps its own target (ADR-087), but the bar saves it too (ADR-095).
	const saveables: readonly SaveEntry[] = parts.endpoints
		? [...scoped, ["providers", parts.endpoints]]
		: scoped;
	return (
		<>
			<Hero
				onRefresh={actions.onRefresh}
				note={
					<p className="mete-settings-note">
						{nls.localize(
							"mete/settings/loaded",
							"As METE loaded them at {0}. Edits to these files apply when METE starts again or on Apply now, except pins, which apply when the next task starts; a key no file sets takes its module's built-in default.",
							new Date(settings.loadedAt).toLocaleString(),
						)}
					</p>
				}
				scope={
					target ? (
						<ScopeSwitch
							target={target}
							canGlobal={settings.globalFile !== undefined}
							onTarget={actions.onScope}
						/>
					) : undefined
				}
			/>
			<div className="mete-settings-columns">
				<GroupList groups={groups} chosen={chosen} onGroup={choice.onGroup} />
				<div className="mete-settings-body">
					{chosen ? (
						<GroupBody
							group={chosen}
							settings={settings}
							actions={actions}
							parts={parts}
						/>
					) : null}
					<SaveBar entries={saveables} onSave={actions.onSaveAll}>
						<ApplyNow apply={apply} onApply={actions.onApply} />
					</SaveBar>
				</div>
			</div>
		</>
	);
};

// Before METE has answered, the hero band and what the screen waits for or why it has nothing.
const Waiting = ({
	model,
	onRefresh,
}: {
	readonly model: Exclude<SettingsModel, { kind: "settings" }>;
	readonly onRefresh: () => void;
}) => (
	<>
		<Hero onRefresh={onRefresh} />
		{model.kind === "loading" ? (
			<p className="mete-settings-state">
				{nls.localize("mete/settings/loading", "Asking the METE daemon…")}
			</p>
		) : null}
		{model.kind === "no_folder" ? (
			<p className="mete-settings-state">{noFolderText()}</p>
		) : null}
		{model.kind === "failed" ? (
			<p className="mete-settings-state" role="alert">
				{failureText(model.failure)}
			</p>
		) : null}
	</>
);

/** The Settings screen for a model. */
export const SettingsView = ({
	model,
	actions,
	forms = {},
	endpoints,
	bindings,
	mcp,
	apply = { busy: false, activeRuns: 0 },
	choice = { group: "models", onGroup: () => {} },
}: {
	readonly model: SettingsModel;
	readonly actions: SettingsActions;
	readonly forms?: Forms;
	readonly endpoints?: Endpoints | undefined;
	readonly bindings?: Bindings | undefined;
	readonly mcp?: Mcp | undefined;
	readonly apply?: ApplyState;
	readonly choice?: GroupChoice;
}) => (
	<section className="mete-screen mete-settings" aria-live="polite">
		{model.kind === "settings" ? (
			<Loaded
				settings={model.settings}
				actions={actions}
				parts={{ forms, endpoints, bindings, mcp }}
				apply={apply}
				choice={choice}
			/>
		) : (
			<Waiting model={model} onRefresh={actions.onRefresh} />
		)}
	</section>
);
