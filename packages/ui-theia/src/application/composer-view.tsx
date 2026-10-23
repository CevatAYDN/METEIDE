import { nls } from "@theia/core/lib/common/nls";
import type { ComposerOption } from "./composer.js";
import { MUTED, PANEL, ROW, TITLE } from "./look.js";
import { noFolderText } from "./status-text.js";

// The run composer's screen (docs/13, Run composer; ADR-071): the goal, the teams to pick from with
// their request estimates, and Start. The view holds no state: the widget passes it and the actions.
// Text is shown as it is: React escapes it, Markdown is not involved.

/** What the screen is showing: waiting for the lists, no folder, or the teams on offer. */
export type ComposerModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| {
			readonly kind: "ready";
			readonly options: readonly ComposerOption[];
			/** The router was unsure: the list holds its suggestions and a single agent. */
			readonly unsure: boolean;
	  };

/** What the user has typed and picked, and what Start is doing. */
export type ComposerInput = {
	readonly goal: string;
	readonly selected: string;
	readonly busy: boolean;
	readonly error?: string | undefined;
};

type Props = ComposerInput & {
	readonly model: ComposerModel;
	readonly onGoal: (goal: string) => void;
	readonly onSelect: (key: string) => void;
	readonly onStart: () => void;
};

const Option = ({
	option,
	checked,
	onSelect,
}: {
	readonly option: ComposerOption;
	readonly checked: boolean;
	readonly onSelect: (key: string) => void;
}) => (
	<label className="mete-card mete-option">
		<input
			type="radio"
			name="mete-team"
			checked={checked}
			onChange={() => onSelect(option.key)}
		/>
		<span>
			<strong>{option.label}</strong>
			{option.description ? (
				<span style={MUTED}> · {option.description}</span>
			) : null}
			{option.estimate ? (
				<>
					<br />
					<span style={MUTED}>{option.estimate}</span>
				</>
			) : null}
		</span>
	</label>
);

const Teams = ({
	model,
	selected,
	onSelect,
}: Pick<Props, "selected" | "onSelect"> & {
	readonly model: Extract<ComposerModel, { kind: "ready" }>;
}) => (
	<fieldset style={{ border: "none", padding: 0, margin: 0 }}>
		<legend style={TITLE}>
			{nls.localize("mete/run/pickStart", "Which team should work on it?")}
		</legend>
		{model.unsure ? (
			<p role="status">
				{nls.localize(
					"mete/run/pickTeam",
					"METE is not sure which team fits this goal; choose one",
				)}
			</p>
		) : null}
		<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
			{model.options.map((o) => (
				<Option
					key={o.key}
					option={o}
					checked={o.key === selected}
					onSelect={onSelect}
				/>
			))}
		</div>
	</fieldset>
);

const Message = ({ children }: { readonly children: string }) => (
	<section style={PANEL}>
		<p>{children}</p>
	</section>
);

/** The composer for a model and the user's input; Ctrl+Enter in the goal starts the run. */
export const ComposerView = (props: Props) => {
	const { model, goal, selected, busy, error } = props;
	if (model.kind === "no_folder") return <Message>{noFolderText()}</Message>;
	if (model.kind === "loading")
		return (
			<Message>
				{nls.localize(
					"mete/run/estimating",
					"METE is estimating the requests…",
				)}
			</Message>
		);
	const ready = goal.trim().length > 0 && !busy;
	return (
		<section style={PANEL}>
			<h2 style={TITLE}>
				{nls.localize("mete/composer/title", "Start a run")}
			</h2>
			<label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
				{nls.localize("mete/run/goal", "What should METE do in this folder?")}
				<textarea
					className="mete-field"
					rows={4}
					value={goal}
					onChange={(e) => props.onGoal(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ready)
							props.onStart();
					}}
				/>
			</label>
			<Teams model={model} selected={selected} onSelect={props.onSelect} />
			<div style={ROW}>
				<button
					type="button"
					className="mete-button"
					disabled={!ready}
					onClick={props.onStart}
				>
					{nls.localize("mete/run/start", "Start run")}
				</button>
				{busy ? (
					<span style={MUTED} role="status">
						{nls.localize("mete/run/starting", "METE is starting the run…")}
					</span>
				) : null}
			</div>
			{error ? <p role="alert">{error}</p> : null}
		</section>
	);
};
