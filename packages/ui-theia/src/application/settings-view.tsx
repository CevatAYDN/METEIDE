import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { stringify } from "yaml";
import type { DaemonFailure, Settings } from "../domain/status-service.js";
import { LINK, MUTED, PANEL, ROW, TITLE } from "./look.js";
import { failureText, noFolderText } from "./status-text.js";

// The read-only Settings screen (docs/13, Settings; ADR-081): the configuration the daemon loaded,
// each section merged and per file with the file's path, shown as YAML text. It leads to what
// Settings has elsewhere: the team editor, provider keys and Theia's preferences and language.

/** What the screen draws. */
export type SettingsModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly failure: DaemonFailure }
	| { readonly kind: "settings"; readonly settings: Settings };

/** Where the screen's links go: a palette command by id, or a configuration file. */
export type SettingsActions = {
	readonly onCommand: (id: string) => void;
	readonly onOpen: (file: string) => void;
	readonly onRefresh: () => void;
};

/** The commands the screen leads to: METE's own and Theia's (their ids are Theia's, 1.76). */
export const SETTINGS_LINKS = [
	[
		"mete.team.edit",
		() => nls.localize("mete/settings/editTeam", "Edit team…"),
	],
	[
		"mete.key.set",
		() => nls.localize("mete/settings/setKey", "Set provider key…"),
	],
	[
		"preferences:open",
		() => nls.localize("mete/settings/preferences", "Preferences"),
	],
	[
		"workbench.action.configureLanguage",
		() => nls.localize("mete/settings/language", "Display language"),
	],
] as const;

const CODE: CSSProperties = {
	margin: "4px 0 0",
	padding: "8px 10px",
	whiteSpace: "pre-wrap",
	overflowWrap: "anywhere",
	fontFamily: "monospace",
	fontSize: "0.92em",
};

// YAML text of a value; a missing section value reads as an empty mapping.
const yamlOf = (value: unknown) => stringify(value ?? {}).trimEnd();

type Section = Settings["sections"][number];

const FileValue = ({
	label,
	from,
	onOpen,
}: {
	readonly label: string;
	readonly from: { readonly file: string; readonly value: unknown };
	readonly onOpen: (file: string) => void;
}) => (
	<div>
		<span style={MUTED}>{label} </span>
		<button
			type="button"
			style={LINK}
			title={from.file}
			onClick={() => onOpen(from.file)}
		>
			{from.file}
		</button>
		<pre className="mete-card" style={CODE}>
			{yamlOf(from.value)}
		</pre>
	</div>
);

const SectionCard = ({
	section,
	onOpen,
}: {
	readonly section: Section;
	readonly onOpen: (file: string) => void;
}) => (
	<section className="mete-card" aria-label={section.name}>
		<h3 style={TITLE}>{section.name}</h3>
		{/* With one file the merged value is that file's; with both, it is what modules read. */}
		{section.global && section.workspace ? (
			<div>
				<span style={MUTED}>
					{nls.localize("mete/settings/merged", "What METE uses:")}
				</span>
				<pre style={CODE}>{yamlOf(section.merged)}</pre>
			</div>
		) : null}
		{section.global ? (
			<FileValue
				label={nls.localize("mete/settings/global", "Global:")}
				from={section.global}
				onOpen={onOpen}
			/>
		) : null}
		{section.workspace ? (
			<FileValue
				label={nls.localize("mete/settings/workspace", "This folder:")}
				from={section.workspace}
				onOpen={onOpen}
			/>
		) : null}
	</section>
);

const Loaded = ({
	settings,
	actions,
}: {
	readonly settings: Settings;
	readonly actions: SettingsActions;
}) => (
	<>
		<p style={MUTED}>
			{nls.localize(
				"mete/settings/loaded",
				"As METE loaded them at {0}. Edits to these files apply when METE starts again, except pins, which apply when the next task starts; a key no file sets takes its module's built-in default.",
				new Date(settings.loadedAt).toLocaleString(),
			)}
		</p>
		{settings.sections.map((s) => (
			<SectionCard key={s.name} section={s} onOpen={actions.onOpen} />
		))}
	</>
);

/** The Settings screen for a model. */
export const SettingsView = ({
	model,
	actions,
}: {
	readonly model: SettingsModel;
	readonly actions: SettingsActions;
}) => (
	<section style={PANEL} aria-live="polite">
		<h2 style={TITLE}>{nls.localize("mete/settings/title", "Settings")}</h2>
		<div style={ROW}>
			{SETTINGS_LINKS.map(([id, label]) => (
				<button
					type="button"
					key={id}
					className="mete-button quiet"
					onClick={() => actions.onCommand(id)}
				>
					{label()}
				</button>
			))}
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
			<Loaded settings={model.settings} actions={actions} />
		) : null}
	</section>
);
