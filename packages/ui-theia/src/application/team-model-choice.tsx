import type { ModelRef } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import { modelRefOf } from "./composer.js";
import { MUTED } from "./look.js";

/** Commits a model preference change: null when empty, ModelRef when valid (ADR-122). */
export const commitModel = (
	roleId: string,
	text: string,
	onModel?: ((roleId: string, model: ModelRef | null) => void) | undefined,
): void => {
	const trimmed = text.trim();
	if (!trimmed) {
		onModel?.(roleId, null);
		return;
	}
	const ref = modelRefOf(trimmed);
	if (ref) onModel?.(roleId, ref);
};

export type ModelChoiceProps = {
	readonly roleId: string;
	readonly value?: string | undefined;
	readonly models: readonly string[];
	readonly onModel?:
		| ((roleId: string, model: ModelRef | null) => void)
		| undefined;
};

const ModelList = ({
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

const ModelChoiceField = ({
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

const RevertButton = ({ onRevert }: { readonly onRevert: () => void }) => (
	<button
		type="button"
		className="mete-button quiet"
		style={{ padding: "1px 6px", fontSize: "0.85em" }}
		title={nls.localize("mete/roster/revertModel", "Revert to default")}
		onClick={onRevert}
	>
		{nls.localize("mete/roster/revertModel", "Revert to default")}
	</button>
);

const ModelChoiceInput = ({
	roleId,
	value,
	models,
	onModel,
}: ModelChoiceProps) => {
	const [draft, setDraft] = useState(value ?? "");
	const current = draft || value || "";
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
				onCommit={(v) => commitModel(roleId, v, onModel)}
			/>
			{current ? (
				<RevertButton
					onRevert={() => {
						setDraft("");
						onModel?.(roleId, null);
					}}
				/>
			) : null}
		</div>
	);
};

/** A mid-run model preference input for a team member card (ADR-122). */
export const ModelChoice = (props: ModelChoiceProps) => (
	<ModelChoiceInput key={`${props.roleId}:${props.value ?? ""}`} {...props} />
);
