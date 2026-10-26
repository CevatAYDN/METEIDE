import type { ModelRef } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useRef, useState } from "react";
import { modelRefOf } from "./composer.js";
import { MUTED } from "./look.js";

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
	readonly onModel?:
		| ((roleId: string, model: ModelRef | null) => void)
		| undefined;
};

export const ModelList = ({
	id,
	models,
}: {
	readonly id: string;
	readonly models: readonly string[];
}) => (
	<datalist id={id}>
		{models.map((m) => (
			<option key={m} value={m} />
		))}
	</datalist>
);

export const ModelChoiceField = ({
	roleId,
	draft,
	models,
	onDraft,
	onCommit,
}: {
	readonly roleId: string;
	readonly draft: string;
	readonly models: readonly string[];
	readonly onDraft: (v: string) => void;
	readonly onCommit: (v: string) => void;
}) => {
	const listId = `roster-models-${roleId}`;
	return (
		<label style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
			<span style={MUTED}>
				{nls.localize("mete/roster/preferModel", "Preferred model (optional)")}
			</span>
			<input
				className="mete-field"
				list={listId}
				value={draft}
				placeholder="providerId/modelId"
				title={nls.localize("mete/roster/changeModel", "Change model")}
				aria-label={nls.localize(
					"mete/roster/preferModel",
					"Preferred model (optional)",
				)}
				onChange={(e) => {
					onDraft(e.target.value);
					if (models.includes(e.target.value)) onCommit(e.target.value);
				}}
				onKeyDown={(e) => e.key === "Enter" && onCommit(draft)}
				onBlur={() => onCommit(draft)}
				style={{ maxWidth: "220px" }}
			/>
			<ModelList id={listId} models={models} />
		</label>
	);
};

export const RevertButton = ({
	onRevert,
}: {
	readonly onRevert: () => void;
}) => (
	<button
		type="button"
		className="mete-button quiet"
		style={{ padding: "1px 6px", fontSize: "0.85em" }}
		title={nls.localize("mete/roster/revertModel", "Revert to default")}
		onMouseDown={(e) => e.preventDefault()}
		onClick={onRevert}
	>
		{nls.localize("mete/roster/revertModel", "Revert to default")}
	</button>
);

export const ModelChoiceInput = ({
	roleId,
	value,
	models,
	onModel,
}: ModelChoiceProps) => {
	const [draft, setDraft] = useState(value ?? "");
	// What the field last sent: a blur after a pick would otherwise send the same model again.
	const sent = useRef<string | undefined>(value ?? "");
	const revert = () => {
		setDraft("");
		if (!sent.current) return;
		sent.current = "";
		onModel?.(roleId, null);
	};
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: "6px",
				flexWrap: "wrap",
			}}
		>
			<ModelChoiceField
				roleId={roleId}
				draft={draft}
				models={models}
				onDraft={setDraft}
				onCommit={(v) => {
					sent.current = commitModel(roleId, v, sent.current, onModel);
				}}
			/>
			{draft ? <RevertButton onRevert={revert} /> : null}
		</div>
	);
};

/** A mid-run model preference input for a team member card (ADR-122). */
export const ModelChoice = (props: ModelChoiceProps) => (
	<ModelChoiceInput key={`${props.roleId}:${props.value ?? ""}`} {...props} />
);
