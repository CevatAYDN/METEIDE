import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import type { ComposerOption, PickerFacts } from "./composer.js";
import { Side } from "./composer-side.js";
import { Teams } from "./composer-teams.js";
import { Icon } from "./roster-look.js";
import { noFolderText } from "./status-text.js";

// The compact run composer (docs/13; ADR-180): goal, model/tools and Start on one surface,
// with explicit teams and their estimates below. The widget owns state and actions.
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
	readonly preparing?: boolean | undefined;
	readonly error?: string | undefined;
	readonly singleModel?: string | undefined;
	readonly roleModels?: Readonly<Record<string, string>> | undefined;
	/** The folder's uncommitted changes, as `mete/changes` lists them (ADR-156). */
	readonly uncommitted?: number | undefined;
	/** The listed models' facts and the providers' states, for the model picker (ADR-161). */
	readonly picker?: PickerFacts | undefined;
};

type Props = ComposerInput & {
	readonly tools?: ReactNode;
	readonly skills?: ReactNode;
	readonly attachments?: ReactNode;
	readonly model: ComposerModel;
	readonly onGoal: (goal: string) => void;
	readonly onSelect: (key: string) => void;
	readonly onStart: () => void;
	readonly onOpenFolder: () => void;
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
	busy,
	onGoal,
	onStart,
}: {
	readonly goal: string;
	readonly ready: boolean;
	readonly busy: boolean;
	readonly onGoal: (goal: string) => void;
	readonly onStart: () => void;
}) => (
	<label className="mete-composer-field">
		{nls.localize("mete/run/goal", "What should METE do in this folder?")}
		<textarea
			className="mete-field"
			rows={2}
			placeholder={nls.localize(
				"mete/run/goalHint",
				"Describe the task you want METE to complete.",
			)}
			value={goal}
			disabled={busy}
			onChange={(e) => onGoal(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ready) onStart();
			}}
		/>
	</label>
);

/** The composer for a model and the user's input; Ctrl+Enter in the goal starts the run. */
const TeamChoices = (
	props: Props & { readonly model: Extract<ComposerModel, { kind: "ready" }> },
) => {
	const teams = (
		<Teams
			options={props.model.options}
			unsure={props.model.unsure}
			selected={props.selected}
			onSelect={props.onSelect}
			onEdit={props.onEdit}
			onNewTeam={props.onNewTeam}
		/>
	);
	return props.selected === "single" && !props.model.unsure ? (
		<details className="mete-chat-details">
			<summary>{nls.localize("mete/chat/teams", "Use a team instead")}</summary>
			{teams}
		</details>
	) : (
		teams
	);
};

export const ComposerView = (props: Props) => {
	const { model, goal, selected, busy } = props;
	if (model.kind === "no_folder")
		return (
			<section className="mete-composer">
				<p>{noFolderText()}</p>
				<button
					type="button"
					className="mete-button"
					onClick={props.onOpenFolder}
				>
					<Icon name="new-folder" />
					{nls.localize("mete/home/openFolder", "Open folder…")}
				</button>
			</section>
		);
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
				<GoalField {...props} ready={ready} />
				{props.attachments}
				<Side
					{...props}
					chosen={model.options.find((o) => o.key === selected)}
					uncommitted={props.uncommitted}
					ready={ready}
				/>
			</header>
			<fieldset className="mete-context-edit-fields" disabled={busy}>
				<TeamChoices {...props} model={model} />
			</fieldset>
		</section>
	);
};
