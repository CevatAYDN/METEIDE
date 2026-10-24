import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import type { DaemonFailure, Settings } from "../domain/status-service.js";
import { MUTED, PANEL, ROW, TITLE } from "./look.js";
import {
	type Group,
	type GroupId,
	groupsOf,
	SETTINGS_LINKS,
} from "./settings-groups.js";
import {
	type Endpoints,
	type Forms,
	formOf,
	SectionCard,
	withForms,
} from "./settings-section.js";
import { failureText, noFolderText } from "./status-text.js";

// The Settings screen (docs/13, Settings; ADR-081 to ADR-087, ADR-095): the configuration the daemon
// loaded, each section merged and per file with the file's path, grouped in plain words in a list at
// the left. It leads to what Settings has elsewhere: the team editor, provider keys and Theia's
// preferences and language.

export { SETTINGS_LINKS } from "./settings-groups.js";
export type { Endpoints, Forms } from "./settings-section.js";

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
};

/** The group the screen shows, and the choice of another. */
export type GroupChoice = {
	readonly group: GroupId;
	readonly onGroup: (group: GroupId) => void;
};

const LAYOUT: CSSProperties = {
	display: "flex",
	gap: "16px",
	alignItems: "flex-start",
	flexWrap: "wrap",
};
const LIST: CSSProperties = {
	flex: "0 0 240px",
	display: "flex",
	flexDirection: "column",
	gap: "6px",
};
const BODY: CSSProperties = {
	flex: "1 1 480px",
	// One readable column: the forms' fields need no more width than this.
	maxWidth: "760px",
	minWidth: 0,
	display: "flex",
	flexDirection: "column",
	gap: "14px",
};
const ITEM: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "2px",
	textAlign: "left",
	cursor: "pointer",
	font: "inherit",
	color: "inherit",
};

const GroupItem = ({
	group,
	chosen,
	onChoose,
}: {
	readonly group: Group<Settings["sections"][number]>;
	readonly chosen: boolean;
	readonly onChoose: () => void;
}) => (
	<button
		type="button"
		className="mete-card"
		style={ITEM}
		aria-pressed={chosen}
		onClick={onChoose}
	>
		<strong>
			{group.label}
			{group.changedHere ? (
				<span
					role="img"
					style={{
						color: "var(--warn, var(--theia-editorWarning-foreground))",
					}}
					title={nls.localize(
						"mete/groups/changedHere",
						"A value of this group is set for this folder only",
					)}
					aria-label={nls.localize(
						"mete/groups/changedHere",
						"A value of this group is set for this folder only",
					)}
				>
					{" ●"}
				</span>
			) : null}
		</strong>
		<span style={MUTED}>{group.hint}</span>
	</button>
);

// A group's links, for the groups that lead to a command more than to a section.
const Links = ({
	ids,
	onCommand,
}: {
	readonly ids: readonly string[];
	readonly onCommand: (id: string) => void;
}) =>
	ids.length === 0 ? null : (
		<div style={ROW}>
			{SETTINGS_LINKS.filter(([id]) => ids.includes(id)).map(([id, label]) => (
				<button
					type="button"
					key={id}
					className="mete-button quiet"
					onClick={() => onCommand(id)}
				>
					{label()}
				</button>
			))}
		</div>
	);

const Loaded = ({
	settings,
	actions,
	forms,
	endpoints,
	choice,
}: {
	readonly settings: Settings;
	readonly actions: SettingsActions;
	readonly forms: Forms;
	readonly endpoints?: Endpoints | undefined;
	readonly choice: GroupChoice;
}) => {
	const groups = groupsOf(withForms(settings.sections));
	const chosen = groups.find((g) => g.id === choice.group) ?? groups[0];
	return (
		<>
			<p style={MUTED}>
				{nls.localize(
					"mete/settings/loaded",
					"As METE loaded them at {0}. Edits to these files apply when METE starts again or on Apply now, except pins, which apply when the next task starts; a key no file sets takes its module's built-in default.",
					new Date(settings.loadedAt).toLocaleString(),
				)}
			</p>
			<div style={LAYOUT}>
				<nav
					style={LIST}
					aria-label={nls.localize("mete/groups/list", "Settings groups")}
				>
					{groups.map((g) => (
						<GroupItem
							key={g.id}
							group={g}
							chosen={g.id === chosen?.id}
							onChoose={() => choice.onGroup(g.id)}
						/>
					))}
				</nav>
				{chosen ? (
					<div style={BODY}>
						<h3 style={TITLE}>{chosen.label}</h3>
						<Links ids={chosen.links} onCommand={actions.onCommand} />
						{chosen.sections.map((s) => (
							<SectionCard
								key={s.name}
								section={s}
								onOpen={actions.onOpen}
								form={formOf(s.name, forms, settings, endpoints)}
							/>
						))}
					</div>
				) : null}
			</div>
		</>
	);
};

/** Apply now (ADR-083): in flight, and how many runs of the folder are queued or running. */
export type ApplyState = {
	readonly busy: boolean;
	readonly activeRuns: number;
};

// A restart pauses a running run (ADR-061), so Apply now waits until none runs.
const ApplyNow = ({
	apply,
	onApply,
}: {
	readonly apply: ApplyState;
	readonly onApply: () => void;
}) => (
	<>
		<button
			type="button"
			className="mete-button"
			disabled={apply.busy || apply.activeRuns > 0}
			onClick={onApply}
		>
			{apply.busy
				? nls.localize("mete/settings/applying", "Restarting METE…")
				: nls.localize("mete/settings/apply", "Apply now")}
		</button>
		{apply.activeRuns > 0 ? (
			<span style={MUTED}>
				{nls.localize(
					"mete/settings/applyWaits",
					"A run is running; Apply now waits until it is paused or ends.",
				)}
			</span>
		) : null}
	</>
);

/** The Settings screen for a model. */
export const SettingsView = ({
	model,
	actions,
	forms = {},
	endpoints,
	apply = { busy: false, activeRuns: 0 },
	choice = { group: "models", onGroup: () => {} },
}: {
	readonly model: SettingsModel;
	readonly actions: SettingsActions;
	readonly forms?: Forms;
	readonly endpoints?: Endpoints | undefined;
	readonly apply?: ApplyState;
	readonly choice?: GroupChoice;
}) => (
	<section style={{ ...PANEL, maxWidth: "1100px" }} aria-live="polite">
		<h2 style={TITLE}>{nls.localize("mete/settings/title", "Settings")}</h2>
		<div style={ROW}>
			<ApplyNow apply={apply} onApply={actions.onApply} />
			<button
				type="button"
				className="mete-button quiet"
				onClick={actions.onRefresh}
			>
				{nls.localize("mete/settings/refresh", "Refresh")}
			</button>
		</div>
		{model.kind === "loading" ? (
			<p>{nls.localize("mete/settings/loading", "Asking the METE daemon…")}</p>
		) : null}
		{model.kind === "no_folder" ? <p>{noFolderText()}</p> : null}
		{model.kind === "failed" ? (
			<p role="alert">{failureText(model.failure)}</p>
		) : null}
		{model.kind === "settings" ? (
			<Loaded
				settings={model.settings}
				actions={actions}
				forms={forms}
				endpoints={endpoints}
				choice={choice}
			/>
		) : null}
	</section>
);
