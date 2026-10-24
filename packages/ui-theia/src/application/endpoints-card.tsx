import type { ProviderAdapter } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { EndpointDraft } from "./endpoints-draft.js";
import { MUTED, ROW } from "./look.js";
import type { Target } from "./section-draft.js";
import { shortPath } from "./settings-form.js";

// The custom endpoints card of the providers section (ADR-087): one set of fields per endpoint, Add
// and Remove, and Save to the global settings.yaml or, on request, this folder's providers.yaml.

/** The card's state, which the widget keeps. */
export type EndpointsState = {
	readonly target: Target;
	/** The file the card edits now, or none when the global file is unknown. */
	readonly file?: string | undefined;
	readonly list: readonly EndpointDraft[];
	readonly busy: boolean;
	readonly dirty: boolean;
	readonly note?:
		| { readonly kind: "saved" | "refused"; readonly text: string }
		| undefined;
};

/** What the card asks the widget for. */
export type EndpointsActions = {
	readonly onEdit: (
		index: number,
		field: keyof EndpointDraft,
		value: string,
	) => void;
	readonly onAdd: () => void;
	readonly onRemove: (index: number) => void;
	readonly onTarget: (target: Target) => void;
	readonly onSave: () => void;
};

// The formats of provider.chat@2; the type keeps this list in step with the contract.
const FORMATS: readonly ProviderAdapter["format"][] = [
	"openai-chat",
	"anthropic-messages",
	"google-gemini",
];

const COLUMN = {
	display: "flex",
	flexDirection: "column",
	gap: "4px",
} as const;

const Text = ({
	id,
	label,
	value,
	onChange,
}: {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly onChange: (v: string) => void;
}) => (
	<div style={COLUMN}>
		<label htmlFor={id}>{label}</label>
		<input
			id={id}
			className="mete-field"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		/>
	</div>
);

// A new endpoint's format stays unset until the user picks one; Save refuses it until then.
const Format = ({
	id,
	value,
	onChange,
}: {
	readonly id: string;
	readonly value: string;
	readonly onChange: (v: string) => void;
}) => (
	<div style={COLUMN}>
		<label htmlFor={id}>
			{nls.localize("mete/settings/format", "API format")}
		</label>
		<select
			id={id}
			className="mete-field"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			<option value="">
				{nls.localize("mete/settings/chooseFormat", "Choose…")}
			</option>
			{FORMATS.map((f) => (
				<option key={f} value={f}>
					{f}
				</option>
			))}
		</select>
	</div>
);

const EndpointFields = ({
	index,
	endpoint,
	actions,
}: {
	readonly index: number;
	readonly endpoint: EndpointDraft;
	readonly actions: EndpointsActions;
}) => {
	const id = (field: string) => `mete-endpoint-${index}-${field}`;
	const edit = (field: keyof EndpointDraft) => (v: string) =>
		actions.onEdit(index, field, v);
	return (
		<fieldset className="mete-card" style={COLUMN}>
			<Text
				id={id("name")}
				label={nls.localize("mete/settings/endpointName", "Name")}
				value={endpoint.name}
				onChange={edit("name")}
			/>
			<Text
				id={id("slug")}
				label={nls.localize("mete/settings/slug", "Slug")}
				value={endpoint.slug}
				onChange={edit("slug")}
			/>
			<Text
				id={id("baseUrl")}
				label={nls.localize("mete/settings/baseUrl", "Base URL")}
				value={endpoint.baseUrl}
				onChange={edit("baseUrl")}
			/>
			<Format
				id={id("format")}
				value={endpoint.format}
				onChange={edit("format")}
			/>
			<label htmlFor={id("headers")}>
				{nls.localize(
					"mete/settings/headers",
					"Extra headers, one Name: value per line",
				)}
			</label>
			<textarea
				id={id("headers")}
				className="mete-field"
				rows={2}
				value={endpoint.headers}
				onChange={(e) => edit("headers")(e.target.value)}
			/>
			<div style={ROW}>
				<button
					type="button"
					className="mete-button quiet"
					onClick={() => actions.onRemove(index)}
				>
					{nls.localize("mete/settings/remove", "Remove")}
				</button>
			</div>
		</fieldset>
	);
};

const SaveTarget = ({
	state,
	actions,
}: {
	readonly state: EndpointsState;
	readonly actions: EndpointsActions;
}) => (
	<div style={COLUMN}>
		<label style={ROW}>
			<input
				type="checkbox"
				checked={state.target === "workspace"}
				onChange={(e) =>
					actions.onTarget(e.target.checked ? "workspace" : "global")
				}
			/>
			{nls.localize("mete/settings/folderOnly", "Save for this folder only")}
		</label>
		<span style={MUTED}>
			{nls.localize(
				"mete/settings/folderHides",
				"A folder's list hides the global endpoints in this folder.",
			)}
		</span>
	</div>
);

/** The providers section's card: its endpoints, where they save, and Save. */
export const EndpointsCard = ({
	state,
	actions,
}: {
	readonly state: EndpointsState;
	readonly actions: EndpointsActions;
}) => (
	<div style={{ ...COLUMN, gap: "8px" }}>
		{state.list.map((endpoint, i) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: an endpoint has no stable id while its slug is typed
			<EndpointFields key={i} index={i} endpoint={endpoint} actions={actions} />
		))}
		<SaveTarget state={state} actions={actions} />
		<div style={ROW}>
			<button
				type="button"
				className="mete-button quiet"
				onClick={actions.onAdd}
			>
				{nls.localize("mete/settings/addEndpoint", "Add endpoint")}
			</button>
			<button
				type="button"
				className="mete-button"
				disabled={state.busy || !state.dirty || state.file === undefined}
				onClick={actions.onSave}
			>
				{nls.localize("mete/settings/save", "Save")}
			</button>
		</div>
		{state.file ? (
			<span style={MUTED} title={state.file}>
				{nls.localize(
					"mete/settings/savesTo",
					"Saves to {0}",
					shortPath(state.file),
				)}
			</span>
		) : null}
		{state.note ? (
			<p role={state.note.kind === "refused" ? "alert" : undefined}>
				{state.note.text}
			</p>
		) : null}
	</div>
);
