import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { optionLabel } from "./labels.js";
import { MUTED } from "./look.js";
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

/** What a save said, or why it wrote nothing (ADR-082). */
export type SaveNote = {
	readonly kind: "saved" | "refused";
	readonly text: string;
};

/** One form's state, which the widget keeps. */
export type FormState = {
	readonly target: Target;
	/** The file the form edits now, or none when the global file is unknown. */
	readonly file?: string | undefined;
	readonly values: Draft;
	readonly defaults: Draft;
	readonly busy: boolean;
	/** Whether the user changed a field since the file was read; Save waits for a change. */
	readonly dirty: boolean;
	readonly note?: SaveNote | undefined;
};

/** What a form asks the widget for. */
export type FormActions = {
	readonly onField: (key: string, value: FieldValue) => void;
	readonly onTarget: (target: Target) => void;
	readonly onSave: () => void;
	/** Removes the form's keys from this folder's file, whichever target the form shows. */
	readonly onClear: () => void;
};

/** The column a form's parts stand in. */
export const FORM: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "8px",
};

/**
 * A configuration file as the screen names it: a folder's file from its `.mete` folder on, since the
 * open folder is known; any other file, such as the global settings.yaml, whole.
 */
export const shortPath = (file: string) => {
	const at = file.search(/[\\/]\.mete[\\/][^\\/]+$/);
	return at >= 0 ? file.slice(at + 1) : file;
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
	windows: () => nls.localize("mete/settings/windowsShell", "Windows shell"),
	gitBashPath: () => nls.localize("mete/settings/gitBashPath", "Git Bash path"),
};

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

// The input a field's kind asks for: a number, a line of text, or a choice.
const Value = ({
	id,
	kind,
	value,
	fallback,
	onChange,
}: {
	readonly id: string;
	readonly kind: FieldSpec["kind"];
	readonly value: FieldValue;
	readonly fallback: FieldValue;
	readonly onChange: (v: FieldValue) => void;
}) => {
	if (kind.type === "number")
		return (
			<input
				id={id}
				className="mete-field"
				type="number"
				step={kind.integer ? 1 : "any"}
				value={value === undefined ? "" : String(value)}
				placeholder={defaultLabel(String(fallback))}
				onChange={(e) =>
					onChange(e.target.value === "" ? undefined : Number(e.target.value))
				}
			/>
		);
	if (kind.type === "text")
		return (
			<input
				id={id}
				className="mete-field"
				value={value === undefined ? "" : String(value)}
				onChange={(e) =>
					onChange(e.target.value === "" ? undefined : e.target.value)
				}
			/>
		);
	return (
		<Choice
			id={id}
			options={kind.type === "switch" ? [true, false] : kind.options}
			value={value}
			fallback={fallback}
			onChange={onChange}
		/>
	);
};

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
	const id = `mete-setting-${key}`;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
			<label htmlFor={id}>{LABELS[key]?.() ?? key}</label>
			<Value
				id={id}
				kind={spec.kind}
				value={state.values[key]}
				fallback={state.defaults[key]}
				onChange={(v) => onField(key, v)}
			/>
		</div>
	);
};

/** A form's fields, one after the other. */
export const FormFields = ({
	section,
	state,
	onField,
}: {
	readonly section: FormSection;
	readonly state: FormState;
	readonly onField: FormActions["onField"];
}) => (
	<>
		{FORM_FIELDS[section].map((spec) => (
			<Field
				key={spec.path.join(".")}
				spec={spec}
				state={state}
				onField={onField}
			/>
		))}
	</>
);

/** Save, off until a field changed, so an untouched file is never rewritten. */
export const SaveButton = ({
	state,
	onSave,
}: {
	readonly state: FormState;
	readonly onSave: () => void;
}) => (
	<button
		type="button"
		className="mete-button"
		disabled={state.busy || !state.dirty || state.file === undefined}
		onClick={onSave}
	>
		{nls.localize("mete/settings/save", "Save")}
	</button>
);

/** What a card shows of a save: where it writes, and what the last one said. */
export type NoteState = {
	readonly file?: string | undefined;
	readonly note?: SaveNote | undefined;
};

/** The file the form saves to, and what the last save said. */
export const FormNote = ({ state }: { readonly state: NoteState }) => (
	<>
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
	</>
);

/** A form that chooses its own target, as the Welcome screen's (ADR-088) does: fields, target, Save. */
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
	<div style={FORM}>
		<FormFields section={section} state={state} onField={actions.onField} />
		{/* The target, Save and where it writes, as one foot (style/mete-form.css). */}
		<div className="mete-form-foot">
			<div className="mete-form-target">
				<label>
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
				<SaveButton state={state} onSave={actions.onSave} />
			</div>
			<FormNote state={state} />
		</div>
	</div>
);
