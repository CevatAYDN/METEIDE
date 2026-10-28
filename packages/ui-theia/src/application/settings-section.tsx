import type { ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import { stringify } from "yaml";
import type { Settings } from "../domain/status-service.js";
import {
	type BindingsActions,
	BindingsCard,
	type BindingsState,
} from "./bindings-card.js";
import type { EndpointKeysView } from "./endpoint-key.js";
import type { EndpointTestsView } from "./endpoint-test.js";
import {
	type EndpointsActions,
	EndpointsCard,
	type EndpointsState,
} from "./endpoints-card.js";
import { type McpActions, McpCard, type McpState } from "./mcp-card.js";
import { type FormSection, layerOf } from "./section-draft.js";
import { Origin, SectionForm } from "./section-form.js";
import {
	type FormActions,
	type FormState,
	shortPath,
} from "./settings-form.js";
import { sectionTitle } from "./settings-groups.js";

// What one Settings section looks like (ADR-081 to ADR-087): its name, what METE loaded from each
// file as YAML text with the file's path, and its form or card where it has one.

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
	readonly states?: readonly ProviderState[] | undefined;
};

/** The bindings card of the tools group (ADR-096): its state and actions. */
export type Bindings = {
	readonly state: BindingsState;
	readonly actions: BindingsActions;
};

/** The MCP servers card of the tools group (ADR-097): its state and actions. */
export type Mcp = {
	readonly state: McpState;
	readonly actions: McpActions;
};

// The sections with a form or a card always show, also when no file sets them.
const ALWAYS: readonly string[] = [
	"bindings",
	"gateway",
	"mcp",
	"policy",
	"privacy",
	"providers",
	"shell",
];

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
	<div className="mete-settings-file">
		<p>
			{label}{" "}
			<button
				type="button"
				className="mete-settings-path"
				title={from.file}
				onClick={() => onOpen(from.file)}
			>
				{shortPath(from.file)}
			</button>
		</p>
		<pre>{yamlOf(from.value)}</pre>
	</div>
);

// The plain-words title with the section id beside it, as tier tiles show the tier id (ADR-095).
const SectionTitle = ({ name }: { readonly name: string }) => {
	const title = sectionTitle(name);
	return (
		<h3>
			{title ?? name}
			{title ? <span className="mete-settings-id">{` · ${name}`}</span> : null}
		</h3>
	);
};

export const SectionCard = ({
	section,
	onOpen,
	origin,
	form,
}: {
	readonly section: Section;
	readonly onOpen: (file: string) => void;
} & CardParts) => (
	<section
		className="mete-settings-card"
		aria-label={sectionTitle(section.name) ?? section.name}
	>
		<div className="mete-settings-card-head">
			<SectionTitle name={section.name} />
			{origin}
		</div>
		{!section.global && !section.workspace ? (
			<p className="mete-settings-unset">
				{nls.localize(
					"mete/settings/unset",
					"No file sets this section; its defaults apply.",
				)}
			</p>
		) : null}
		{/* With one file the merged value is that file's; with both, it is what modules read. */}
		{section.global && section.workspace ? (
			<div className="mete-settings-file">
				<p>{nls.localize("mete/settings/merged", "What METE uses:")}</p>
				<pre>{yamlOf(section.merged)}</pre>
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

/** What a section's card needs to draw its form: the loaded settings and the cards' stores. */
export type FormParts = {
	readonly name: string;
	readonly forms: Forms;
	readonly settings: Settings;
	readonly endpoints?: Endpoints | undefined;
	readonly bindings?: Bindings | undefined;
	readonly mcp?: Mcp | undefined;
};

// The sections whose card is not one of ADR-082's forms: a card of their own, with its store.
const CARDS: {
	readonly [name: string]: (parts: FormParts) => ReactNode;
} = {
	providers: ({ endpoints }) =>
		endpoints ? <EndpointsCard {...endpoints} /> : undefined,
	bindings: ({ bindings }) =>
		bindings ? <BindingsCard {...bindings} /> : undefined,
	mcp: ({ mcp }) => (mcp ? <McpCard {...mcp} /> : undefined),
};

/** What a section's card holds besides what METE loaded: its form or card, and where the form's value comes from. */
export type CardParts = {
	readonly origin?: ReactNode;
	readonly form?: ReactNode;
};

// A section's form or card, if it has one, under what METE loaded; a form's origin goes in the head.
export const cardParts = (parts: FormParts): CardParts => {
	const { name, forms, settings } = parts;
	const card = Object.hasOwn(CARDS, name) ? CARDS[name] : undefined;
	if (card) return { form: card(parts) };
	const form = forms[name as FormSection];
	if (!form) return {};
	const loaded = settings.sections.find((s) => s.name === name);
	return {
		origin: (
			<Origin
				layer={loaded && layerOf(name as FormSection, loaded)}
				file={loaded?.workspace?.file}
				busy={form.state.busy}
				onClear={form.actions.onClear}
			/>
		),
		form: (
			<SectionForm
				section={name as FormSection}
				state={form.state}
				actions={form.actions}
				sensitive={sensitiveOf(settings.sections)}
			/>
		),
	};
};
