import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties, ReactNode } from "react";
import { stringify } from "yaml";
import type { DaemonFailure, Settings } from "../domain/status-service.js";
import type { EndpointKeysView } from "./endpoint-key.js";
import {
	type EndpointsActions,
	EndpointsCard,
	type EndpointsState,
} from "./endpoints-card.js";
import { LINK, MUTED, PANEL, ROW, TITLE } from "./look.js";
import type { FormSection } from "./section-draft.js";
import {
	type FormActions,
	type FormState,
	SettingsForm,
	shortPath,
} from "./settings-form.js";
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
	readonly onApply: () => void;
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

/** The forms of the sections that have one (ADR-082), with their state and actions. */
export type Forms = {
	readonly [S in FormSection]?: {
		readonly state: FormState;
		readonly actions: FormActions;
	};
};

/** The custom endpoints card of the providers section (ADR-087): its state, actions and keys. */
export type Endpoints = {
	readonly state: EndpointsState;
	readonly actions: EndpointsActions;
	readonly keys?: EndpointKeysView | undefined;
};

// The sections with a form or a card always show, also when no file sets them.
const ALWAYS: readonly string[] = ["gateway", "policy", "privacy", "providers"];

const withForms = (sections: readonly Section[]): readonly Section[] =>
	[
		...sections,
		...ALWAYS.filter((n) => !sections.some((s) => s.name === n)).map(
			(name) => ({ name, merged: undefined }),
		),
	].sort((a, b) => a.name.localeCompare(b.name));

// docs/09: in a sensitive workspace allowTraining changes nothing.
const sensitiveOf = (sections: readonly Section[]) => {
	const ws = sections.find((s) => s.name === "workspace")?.merged;
	return (
		typeof ws === "object" &&
		ws !== null &&
		(ws as Record<string, unknown>).sensitivity === "sensitive"
	);
};

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
			{shortPath(from.file)}
		</button>
		<pre className="mete-card" style={CODE}>
			{yamlOf(from.value)}
		</pre>
	</div>
);

const SectionCard = ({
	section,
	onOpen,
	form,
}: {
	readonly section: Section;
	readonly onOpen: (file: string) => void;
	readonly form?: ReactNode;
}) => (
	<section className="mete-card" aria-label={section.name}>
		<h3 style={TITLE}>{section.name}</h3>
		{!section.global && !section.workspace ? (
			<p style={MUTED}>
				{nls.localize(
					"mete/settings/unset",
					"No file sets this section; its defaults apply.",
				)}
			</p>
		) : null}
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
		{form}
	</section>
);

// A section's form, if it has one, under what METE loaded.
const formOf = (
	name: string,
	forms: Forms,
	settings: Settings,
	endpoints?: Endpoints,
): ReactNode => {
	if (name === "providers")
		return endpoints ? <EndpointsCard {...endpoints} /> : undefined;
	const form = forms[name as FormSection];
	if (!form) return undefined;
	return (
		<>
			{name === "privacy" && sensitiveOf(settings.sections) ? (
				<p style={MUTED}>
					{nls.localize(
						"mete/settings/sensitive",
						"This folder is sensitive, so providers that train on prompts stay out whatever this says.",
					)}
				</p>
			) : null}
			<SettingsForm
				section={name as FormSection}
				state={form.state}
				actions={form.actions}
				canSaveGlobally={settings.globalFile !== undefined}
			/>
		</>
	);
};

const Loaded = ({
	settings,
	actions,
	forms,
	endpoints,
}: {
	readonly settings: Settings;
	readonly actions: SettingsActions;
	readonly forms: Forms;
	readonly endpoints?: Endpoints | undefined;
}) => (
	<>
		<p style={MUTED}>
			{nls.localize(
				"mete/settings/loaded",
				"As METE loaded them at {0}. Edits to these files apply when METE starts again or on Apply now, except pins, which apply when the next task starts; a key no file sets takes its module's built-in default.",
				new Date(settings.loadedAt).toLocaleString(),
			)}
		</p>
		{withForms(settings.sections).map((s) => (
			<SectionCard
				key={s.name}
				section={s}
				onOpen={actions.onOpen}
				form={formOf(s.name, forms, settings, endpoints)}
			/>
		))}
	</>
);

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
}: {
	readonly model: SettingsModel;
	readonly actions: SettingsActions;
	readonly forms?: Forms;
	readonly endpoints?: Endpoints | undefined;
	readonly apply?: ApplyState;
}) => (
	// One readable column: the forms' fields need no more width than this.
	<section style={{ ...PANEL, maxWidth: "760px" }} aria-live="polite">
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
			/>
		) : null}
	</section>
);
