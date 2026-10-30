import type { ModelRef } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useId, useRef, useState } from "react";
import { modelRefOf, type PickerFacts } from "./composer.js";
import { ModelPicker } from "./model-picker.js";

/**
 * Commits a model the run does not already prefer and answers the preference now in force: empty
 * text commits nothing, since only Revert clears it (ADR-122).
 */
export const commitModel = (
	roleId: string,
	text: string,
	current: string | undefined,
	onModel?: ((roleId: string, model: ModelRef | null) => void) | undefined,
): string | undefined => {
	const ref = modelRefOf(text.trim());
	if (!ref) return current;
	const key = `${ref.providerId}/${ref.modelId}`;
	if (key === current) return current;
	onModel?.(roleId, ref);
	return key;
};

export type ModelChoiceProps = {
	readonly roleId: string;
	readonly value?: string | undefined;
	readonly models: readonly string[];
	/** The candidates' facts and the providers' states (ADR-161). */
	readonly picker?: PickerFacts | undefined;
	readonly onModel?:
		| ((roleId: string, model: ModelRef | null) => void)
		| undefined;
};

export const RevertButton = ({
	onRevert,
}: {
	readonly onRevert: () => void;
}) => (
	<button
		type="button"
		className="mete-button quiet mete-model-revert"
		title={nls.localize("mete/roster/revertModel", "Revert to default")}
		onMouseDown={(e) => e.preventDefault()}
		onClick={onRevert}
	>
		{nls.localize("mete/roster/revertModel", "Revert to default")}
	</button>
);

// A pick is sent at once and Let METE choose is Revert, since only Revert clears (ADR-122, ADR-161);
// typed text is sent when the field is left or Enter meets no row.
export const ModelChoiceInput = ({
	roleId,
	value,
	models,
	picker,
	onModel,
}: ModelChoiceProps) => {
	const [draft, setDraft] = useState(value ?? "");
	const id = useId();
	const label = nls.localize(
		"mete/roster/preferModel",
		"Preferred model (optional)",
	);
	// What the field last sent: a blur after a pick would otherwise send the same model again.
	const sent = useRef<string | undefined>(value ?? "");
	const revert = () => {
		setDraft("");
		if (!sent.current) return;
		sent.current = "";
		onModel?.(roleId, null);
	};
	const commit = (text: string) => {
		sent.current = commitModel(roleId, text, sent.current, onModel);
	};
	return (
		<div className="mete-model-choice">
			<div className="mete-model-field">
				<label className="mete-model-label" htmlFor={id}>
					{label}
				</label>
				<ModelPicker
					id={id}
					label={label}
					value={draft}
					models={models}
					facts={picker?.facts ?? []}
					states={picker?.states ?? []}
					onChange={setDraft}
					onPick={(ref) => {
						if (ref === null) return revert();
						setDraft(ref);
						commit(ref);
					}}
					onCommit={() => commit(draft)}
				/>
			</div>
			{draft ? <RevertButton onRevert={revert} /> : null}
		</div>
	);
};

/** A mid-run model preference input for a team member card (ADR-122). */
export const ModelChoice = (props: ModelChoiceProps) => (
	<ModelChoiceInput key={`${props.roleId}:${props.value ?? ""}`} {...props} />
);
