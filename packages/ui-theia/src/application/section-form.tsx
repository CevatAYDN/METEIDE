import { nls } from "@theia/core/lib/common/nls";
import { MUTED, ROW } from "./look.js";
import type { FormSection, Target } from "./section-draft.js";
import {
	FORM,
	type FormActions,
	FormFields,
	FormNote,
	type FormState,
	SaveButton,
} from "./settings-form.js";

// A form as the Settings screen draws it (ADR-095): where its value comes from, its fields, Save and
// what the last save said. The target is the screen's switch, not a box of the form.

// Where METE loaded a field of the form from: this folder's file, which Reset can clear, or the global one.
const Origin = ({
	layer,
	file,
	busy,
	onClear,
}: {
	readonly layer: Target | undefined;
	readonly file: string | undefined;
	readonly busy: boolean;
	readonly onClear: () => void;
}) => {
	if (layer === undefined) return null;
	if (layer === "global")
		return (
			<span style={MUTED}>
				{nls.localize("mete/settings/originAll", "From all folders' file")}
			</span>
		);
	return (
		<div style={ROW}>
			<span style={MUTED}>
				{nls.localize("mete/settings/originFolder", "Changed for this folder")}
			</span>
			<button
				type="button"
				className="mete-button quiet"
				disabled={busy}
				title={nls.localize(
					"mete/settings/resetHint",
					"Removes these values from {0}, so the global file's value or the default applies again.",
					file ?? "",
				)}
				onClick={onClear}
			>
				{nls.localize("mete/settings/reset", "Reset")}
			</button>
		</div>
	);
};

/** One section's form on the Settings screen. */
export const SectionForm = ({
	section,
	state,
	actions,
	layer,
	folderFile,
	sensitive,
}: {
	readonly section: FormSection;
	readonly state: FormState;
	readonly actions: FormActions;
	readonly layer: Target | undefined;
	readonly folderFile: string | undefined;
	/** docs/09: in a sensitive folder allowTraining changes nothing. */
	readonly sensitive: boolean;
}) => (
	<div style={FORM}>
		{section === "privacy" && sensitive ? (
			<p style={MUTED}>
				{nls.localize(
					"mete/settings/sensitive",
					"This folder is sensitive, so providers that train on prompts stay out whatever this says.",
				)}
			</p>
		) : null}
		<Origin
			layer={layer}
			file={folderFile}
			busy={state.busy}
			onClear={actions.onClear}
		/>
		<FormFields section={section} state={state} onField={actions.onField} />
		<div style={ROW}>
			<SaveButton state={state} onSave={actions.onSave} />
		</div>
		<FormNote state={state} />
	</div>
);
