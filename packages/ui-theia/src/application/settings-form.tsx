import { nls } from "@theia/core/lib/common/nls";
import { MUTED, ROW } from "./look.js";
import {
	type Draft,
	type FieldSpec,
	type FieldValue,
	FORM_FIELDS,
	type FormSection,
	type Target,
} from "./section-draft.js";

// A Settings form (ADR-082): the fields of one section of the target file, each empty until the user
// sets it, with the default as its placeholder; Save writes only what the user changed.

/** One form's state, which the widget keeps. */
export type FormState = {
	readonly target: Target;
	/** The file the form edits now, or none when the global file is unknown. */
	readonly file?: string | undefined;
	readonly values: Draft;
	readonly defaults: Draft;
	readonly busy: boolean;
	readonly note?:
		| { readonly kind: "saved" | "refused"; readonly text: string }
		| undefined;
};

/** What a form asks the widget for. */
export type FormActions = {
	readonly onField: (key: string, value: FieldValue) => void;
	readonly onTarget: (target: Target) => void;
	readonly onSave: () => void;
};

// One literal nls.localize call per text, so Theia's nls-extract can read each.
const LABELS: Readonly<Record<string, () => string>> = {
	models: () => nls.localize("mete/settings/models", "Models"),
	dailySpendUsd: () =>
		nls.localize(
			"mete/settings/dailySpendUsd",
			"Daily spending cap (US dollars)",
		),
	allowTraining: () =>
		nls.localize(
			"mete/settings/allowTraining",
			"Allow providers that may train on prompts",
		),
	autonomy: () => nls.localize("mete/settings/autonomy", "Autonomy level"),
	"budget.cloud_requests_per_run": () =>
		nls.localize("mete/settings/cloudRequests", "Cloud requests per run"),
	"budget.max_hours": () =>
		nls.localize("mete/settings/maxHours", "Hours per run"),
};

const OPTIONS: Readonly<Record<string, () => string>> = {
	free: () => nls.localize("mete/settings/free", "Free models only"),
	paid: () => nls.localize("mete/settings/paid", "Paid models only"),
	both: () => nls.localize("mete/settings/both", "Free first, then paid"),
	"0": () => nls.localize("mete/settings/level0", "0: suggest only"),
	"1": () => nls.localize("mete/settings/level1", "1: approve each step"),
	"2": () => nls.localize("mete/settings/level2", "2: approve risky actions"),
	"3": () => nls.localize("mete/settings/level3", "3: full autonomy"),
	true: () => nls.localize("mete/settings/yes", "Yes"),
	false: () => nls.localize("mete/settings/no", "No"),
};

const optionLabel = (v: string | number | boolean | undefined) =>
	OPTIONS[String(v)]?.() ?? String(v);

// A number shows its default as it is; a choice by its option's name.
const defaultLabel = (text: string) =>
	nls.localize("mete/settings/default", "Default ({0})", text);

// A choice or a switch is a select whose first option leaves the key unset.
const Choice = ({
	id,
	options,
	value,
	fallback,
	onChange,
}: {
	readonly id: string;
	readonly options: readonly (string | number | boolean)[];
	readonly value: FieldValue;
	readonly fallback: FieldValue;
	readonly onChange: (v: FieldValue) => void;
}) => (
	<select
		id={id}
		className="mete-field"
		value={value === undefined ? "" : String(value)}
		onChange={(e) => {
			const picked = options.find((o) => String(o) === e.target.value);
			onChange(picked);
		}}
	>
		<option value="">{defaultLabel(optionLabel(fallback))}</option>
		{options.map((o) => (
			<option key={String(o)} value={String(o)}>
				{optionLabel(o)}
			</option>
		))}
	</select>
);

const Field = ({
	spec,
	state,
	onField,
}: {
	readonly spec: FieldSpec;
	readonly state: FormState;
	readonly onField: FormActions["onField"];
}) => {
	const key = spec.path.join(".");
	const set = (v: FieldValue) => onField(key, v);
	const value = state.values[key];
	const fallback = state.defaults[key];
	const kind = spec.kind;
	const id = `mete-setting-${key}`;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
			<label htmlFor={id}>{LABELS[key]?.() ?? key}</label>
			{kind.type === "number" ? (
				<input
					id={id}
					className="mete-field"
					type="number"
					step={kind.integer ? 1 : "any"}
					value={value === undefined ? "" : String(value)}
					placeholder={defaultLabel(String(fallback))}
					onChange={(e) =>
						set(e.target.value === "" ? undefined : Number(e.target.value))
					}
				/>
			) : (
				<Choice
					id={id}
					options={kind.type === "switch" ? [true, false] : kind.options}
					value={value}
					fallback={fallback}
					onChange={set}
				/>
			)}
		</div>
	);
};

/** One section's form: its fields, where it saves, and Save. */
export const SettingsForm = ({
	section,
	state,
	actions,
	canSaveGlobally,
}: {
	readonly section: FormSection;
	readonly state: FormState;
	readonly actions: FormActions;
	readonly canSaveGlobally: boolean;
}) => (
	<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
		{FORM_FIELDS[section].map((spec) => (
			<Field
				key={spec.path.join(".")}
				spec={spec}
				state={state}
				onField={actions.onField}
			/>
		))}
		<div style={ROW}>
			<label style={ROW}>
				<input
					type="checkbox"
					checked={state.target === "global"}
					disabled={!canSaveGlobally}
					onChange={(e) =>
						actions.onTarget(e.target.checked ? "global" : "workspace")
					}
				/>
				{nls.localize("mete/settings/everyFolder", "Save for every folder")}
			</label>
			<button
				type="button"
				className="mete-button"
				disabled={state.busy || state.file === undefined}
				onClick={actions.onSave}
			>
				{nls.localize("mete/settings/save", "Save")}
			</button>
		</div>
		{state.file ? <span style={MUTED}>{state.file}</span> : null}
		{state.note ? (
			<p role={state.note.kind === "refused" ? "alert" : undefined}>
				{state.note.text}
			</p>
		) : null}
	</div>
);
