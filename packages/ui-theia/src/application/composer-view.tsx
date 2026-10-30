import { nls } from "@theia/core/lib/common/nls";
import type { ComposerOption, PickerFacts } from "./composer.js";
import { Side } from "./composer-side.js";
import { Teams } from "./composer-teams.js";
import { noFolderText } from "./status-text.js";

// The run composer's screen (docs/13, Run composer; ADR-071) in the Composer board's look (ADR-128):
// the goal on top, then the teams to pick from with their request estimates beside the side column
// with Start. The view holds no state: the widget passes it and the actions.
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
	/** The listed models' facts and the providers' states, for the model picker (ADR-161). */
	readonly picker?: PickerFacts | undefined;
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

const Message = ({ children }: { readonly children: string }) => (
	<section className="mete-composer">
		<p>{children}</p>
	</section>
);

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
	<label className="mete-composer-field">
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
		<section className="mete-composer">
			<header className="mete-composer-goal">
				<h2 className="mete-composer-title">
					{nls.localize("mete/composer/title", "Start a run")}
				</h2>
				<GoalField
					goal={goal}
					ready={ready}
					onGoal={props.onGoal}
					onStart={props.onStart}
				/>
			</header>
			<div className="mete-composer-columns">
				<Teams
					options={model.options}
					unsure={model.unsure}
					selected={selected}
					onSelect={props.onSelect}
					onEdit={props.onEdit}
					onNewTeam={props.onNewTeam}
				/>
				<Side
					chosen={model.options.find((o) => o.key === selected)}
					singleModel={props.singleModel}
					roleModels={props.roleModels}
					picker={props.picker}
					onSingleModel={props.onSingleModel}
					onRoleModel={props.onRoleModel}
					uncommitted={props.uncommitted}
					ready={ready}
					busy={busy}
					error={error}
					onStart={props.onStart}
				/>
			</div>
		</section>
	);
};
