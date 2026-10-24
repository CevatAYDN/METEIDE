import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties, ReactNode } from "react";
import { stringify } from "yaml";
import type { Settings } from "../domain/status-service.js";
import type { EndpointKeysView } from "./endpoint-key.js";
import type { EndpointTestsView } from "./endpoint-test.js";
import {
	type EndpointsActions,
	EndpointsCard,
	type EndpointsState,
} from "./endpoints-card.js";
import { LINK, MUTED, TITLE } from "./look.js";
import type { FormSection } from "./section-draft.js";
import {
	type FormActions,
	type FormState,
	SettingsForm,
	shortPath,
} from "./settings-form.js";

// What one Settings section looks like (ADR-081 to ADR-087): its name, what METE loaded from each
// file as YAML text with the file's path, and its form or card where it has one.

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

export type Section = Settings["sections"][number];

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
	readonly tests?: EndpointTestsView | undefined;
};

// The sections with a form or a card always show, also when no file sets them.
const ALWAYS: readonly string[] = ["gateway", "policy", "privacy", "providers"];

export const withForms = (sections: readonly Section[]): readonly Section[] =>
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

export const SectionCard = ({
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
export const formOf = (
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
