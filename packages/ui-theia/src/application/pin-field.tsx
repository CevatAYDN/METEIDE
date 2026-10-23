import { nls } from "@theia/core/lib/common/nls";
import { useId, useState } from "react";
import { FIELD } from "./fields.js";
import { MUTED } from "./look.js";

// A member's pinned model (ADR-077): this folder's setting in .mete/pins.yaml, not the team file's,
// saved when the field is left or Enter is pressed, apart from the team's Save. It offers the models
// of the member's tier and needs and takes any `<providerId>/<modelId>` typed, since no list is
// complete while a provider has no key yet.
// shortcut: a member added in this session gets its pin after the team is saved, since a pin is keyed
// by the id the saved team gives the member; a pin that follows a rename comes with a pins rename.

type Props = {
	/** Whether the member came with the file, so its id is the one the pin is kept under. */
	readonly fixed: boolean;
	readonly value?: string | undefined;
	/** `<providerId>/<modelId>` of the models the member's tier would try, best first. */
	readonly models: readonly string[];
	readonly onPin: (value: string | undefined) => void;
};

const PinInput = ({ value, models, onPin }: Omit<Props, "fixed">) => {
	const [draft, setDraft] = useState(value ?? "");
	const list = useId();
	const commit = () => {
		const next = draft.trim() || undefined;
		if (next !== value) onPin(next);
	};
	return (
		<label style={FIELD}>
			{nls.localize("mete/team/pin", "Pinned model (optional)")}
			<input
				className="mete-field"
				list={list}
				value={draft}
				placeholder="providerId/modelId"
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
				}}
				onBlur={commit}
			/>
			<datalist id={list}>
				{models.map((m) => (
					<option key={m} value={m} />
				))}
			</datalist>
			<span style={MUTED}>
				{models.length === 0
					? nls.localize(
							"mete/team/pinNoModels",
							"No model of this tier is listed now: add a provider key, or type providerId/modelId.",
						)
					: nls.localize(
							"mete/team/pinHint",
							"This folder's setting in .mete/pins.yaml, not the team file's. The pinned model goes first when it can serve the tier; otherwise the tier's other models carry on.",
						)}
			</span>
		</label>
	);
};

/** The pin of a member whose id is settled, or how to get one. */
export const PinField = (props: Props) =>
	props.fixed ? (
		// A saved pin starts the field again from the file.
		<PinInput
			key={props.value ?? ""}
			value={props.value}
			models={props.models}
			onPin={props.onPin}
		/>
	) : (
		<p style={MUTED}>
			{nls.localize(
				"mete/team/pinLater",
				"Save the team to pin this member's model.",
			)}
		</p>
	);
