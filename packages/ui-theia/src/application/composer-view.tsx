import { nls } from "@theia/core/lib/common/nls";
import { useId } from "react";
import type { ComposerOption } from "./composer.js";
import { FIELD } from "./fields.js";
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
	readonly singleModel?: string | undefined;
	readonly roleModels?: Readonly<Record<string, string>> | undefined;
	/** The folder's uncommitted changes, as `mete/changes` lists them (ADR-156). */
	readonly uncommitted?: number | undefined;
};

type Props = ComposerInput & {
	readonly model: ComposerModel;
	readonly onGoal: (goal: string) => void;
	readonly onSelect: (key: string) => void;
	readonly onStart: () => void;
	/** Opens a team in the team editor (ADR-075). */
	readonly onEdit: (templateId: string) => void;
	/** Starts a blank team in the team editor (ADR-093). */
	readonly onNewTeam: () => void;
	readonly onSingleModel?: (model: string) => void;
	readonly onRoleModel?: (roleId: string, model: string) => void;
};

// A team's option carries an Edit button beside it, which opens the team editor (ADR-075).
const Option = ({
	option,
	checked,
	onSelect,
	onEdit,
}: {
	readonly option: ComposerOption;
	readonly checked: boolean;
	readonly onSelect: (key: string) => void;
	readonly onEdit: (templateId: string) => void;
}) => (
	<div style={{ ...ROW, flexWrap: "nowrap", alignItems: "stretch" }}>
		<label className="mete-card mete-option" style={{ flex: 1 }}>
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
		{typeof option.templateId === "string" ? (
			<button
				type="button"
				className="mete-button quiet"
				onClick={() => onEdit(String(option.templateId))}
			>
				{nls.localize("mete/team/editShort", "Edit")}
			</button>
		) : null}
	</div>
);

const Teams = ({
	model,
	selected,
	onSelect,
	onEdit,
}: Pick<Props, "selected" | "onSelect" | "onEdit"> & {
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
					onEdit={onEdit}
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

const ModelChoice = ({
	label,
	value,
	models,
	onChange,
}: {
	readonly label: string;
	readonly value?: string | undefined;
	readonly models: readonly string[];
	readonly onChange: (value: string) => void;
}) => {
	const list = useId();
	return (
		<label style={FIELD}>
			<span>{label}</span>
			<input
				className="mete-field"
				list={list}
				value={value ?? ""}
				placeholder="providerId/modelId"
				onChange={(e) => onChange(e.target.value)}
			/>
			<datalist id={list}>
				{models.map((m) => (
					<option key={m} value={m} />
				))}
			</datalist>
		</label>
	);
};

const SinglePreference = ({
	singleModel,
	models,
	onSingleModel,
}: {
	readonly singleModel?: string | undefined;
	readonly models: readonly string[];
	readonly onSingleModel?: ((model: string) => void) | undefined;
}) => (
	<ModelChoice
		label={nls.localize("mete/run/preferModel", "Preferred model (optional)")}
		value={singleModel}
		models={models}
		onChange={(v) => onSingleModel?.(v)}
	/>
);

const TeamPreferences = ({
	roles,
	roleModels,
	onRoleModel,
}: {
	readonly roles: NonNullable<ComposerOption["roles"]>;
	readonly roleModels?: Readonly<Record<string, string>> | undefined;
	readonly onRoleModel?: ((roleId: string, model: string) => void) | undefined;
}) => (
	<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
		{roles.map((r) => (
			<ModelChoice
				key={r.id}
				label={
					r.name
						? `${r.name} · ${nls.localize("mete/run/preferModel", "Preferred model (optional)")}`
						: nls.localize("mete/run/preferModel", "Preferred model (optional)")
				}
				value={roleModels?.[r.id]}
				models={r.models ?? []}
				onChange={(v) => onRoleModel?.(r.id, v)}
			/>
		))}
	</div>
);

const Preferences = ({
	chosen,
	singleModel,
	roleModels,
	onSingleModel,
	onRoleModel,
}: {
	readonly chosen: ComposerOption | undefined;
	readonly singleModel?: string | undefined;
	readonly roleModels?: Readonly<Record<string, string>> | undefined;
	readonly onSingleModel?: ((model: string) => void) | undefined;
	readonly onRoleModel?: ((roleId: string, model: string) => void) | undefined;
}) => {
	if (!chosen || chosen.templateId === undefined) return null;
	if (chosen.templateId === null) {
		return (
			<SinglePreference
				singleModel={singleModel}
				models={chosen.models ?? []}
				onSingleModel={onSingleModel}
			/>
		);
	}
	return chosen.roles?.length ? (
		<TeamPreferences
			roles={chosen.roles}
			roleModels={roleModels}
			onRoleModel={onRoleModel}
		/>
	) : null;
};

// A team works in worktrees cut at the last commit (docs/10), so the folder's own edits are not in
// them; the single agent works in the folder itself and needs no line (ADR-156).
const Uncommitted = ({
	chosen,
	count,
}: {
	readonly chosen: ComposerOption | undefined;
	readonly count: number | undefined;
}) => {
	if (!count || !chosen || chosen.templateId === null) return null;
	const has =
		count === 1
			? nls.localize(
					"mete/run/uncommittedOne",
					"This folder has 1 uncommitted change.",
				)
			: nls.localize(
					"mete/run/uncommitted",
					"This folder has {0} uncommitted changes.",
					count,
				);
	const why = nls.localize(
		"mete/run/uncommittedWhy",
		"A team starts from the last commit, so its members do not see them; commit them first if the team needs them.",
	);
	return <p style={MUTED}>{`${has} ${why}`}</p>;
};

const GoalField = ({
	goal,
	ready,
	onGoal,
	onStart,
}: {
	readonly goal: string;
	readonly ready: boolean;
	readonly onGoal: (goal: string) => void;
	readonly onStart: () => void;
}) => (
	<label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
		{nls.localize("mete/run/goal", "What should METE do in this folder?")}
		<textarea
			className="mete-field"
			rows={4}
			placeholder={nls.localize(
				"mete/run/goalHint",
				"Add a dark mode toggle to the settings page. Keep the choice in the user's settings file and follow the system theme until the user picks one.",
			)}
			value={goal}
			onChange={(e) => onGoal(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ready) onStart();
			}}
		/>
	</label>
);

const ComposerActions = ({
	ready,
	busy,
	onNewTeam,
	onStart,
}: {
	readonly ready: boolean;
	readonly busy: boolean;
	readonly onNewTeam: () => void;
	readonly onStart: () => void;
}) => (
	<>
		<div style={ROW}>
			<button type="button" className="mete-button quiet" onClick={onNewTeam}>
				{nls.localize("mete/team/new", "New team")}
			</button>
		</div>
		<div style={ROW}>
			<button
				type="button"
				className="mete-button"
				disabled={!ready}
				onClick={onStart}
			>
				{nls.localize("mete/run/start", "Start run")}
			</button>
			{busy ? (
				<span style={MUTED} role="status">
					{nls.localize("mete/run/starting", "METE is starting the run…")}
				</span>
			) : null}
		</div>
	</>
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
			<GoalField
				goal={goal}
				ready={ready}
				onGoal={props.onGoal}
				onStart={props.onStart}
			/>
			<Teams
				model={model}
				selected={selected}
				onSelect={props.onSelect}
				onEdit={props.onEdit}
			/>
			<Preferences
				chosen={model.options.find((o) => o.key === selected)}
				singleModel={props.singleModel}
				roleModels={props.roleModels}
				onSingleModel={props.onSingleModel}
				onRoleModel={props.onRoleModel}
			/>
			<Uncommitted
				chosen={model.options.find((o) => o.key === selected)}
				count={props.uncommitted}
			/>
			<ComposerActions
				ready={ready}
				busy={busy}
				onNewTeam={props.onNewTeam}
				onStart={props.onStart}
			/>
			{error ? <p role="alert">{error}</p> : null}
		</section>
	);
};
