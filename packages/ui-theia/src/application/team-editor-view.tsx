import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import { MUTED, PANEL, ROW, TITLE } from "./look.js";
import { MemberCard, type OnEdit } from "./member-card.js";
import { noFolderText } from "./status-text.js";
import { capabilityHints, type TeamView } from "./team-draft.js";

// The team editor's screen (docs/13, Settings, Templates; ADR-075): the team's name and description,
// its members with their tasks, the schema's issues, and Save, Save as new team and Open YAML. The
// view holds no state but the copy's id and name: the widget passes the draft and the actions.

/** What the screen is showing. */
export type TeamEditorModel =
	| { readonly kind: "none" }
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly text: string }
	| {
			readonly kind: "ready";
			readonly team: TeamView;
			readonly source: "workspace" | "builtIn";
			/** The member ids the file came with: those stay fixed. */
			readonly fixedIds: readonly string[];
			readonly issues: readonly string[];
			readonly busy: boolean;
			readonly changed: boolean;
	  };

/** What the screen's buttons do. */
export type TeamEditorActions = {
	readonly onEdit: OnEdit;
	readonly onAddMember: () => void;
	readonly onRemoveMember: (index: number) => void;
	readonly onAddTask: (roleId: string) => void;
	readonly onRemoveTask: (index: number) => void;
	readonly onSave: () => void;
	readonly onSaveAs: (id: string, name: string) => void;
	readonly onOpenYaml: () => void;
};

type Ready = Extract<TeamEditorModel, { kind: "ready" }>;

const FIELD = { display: "flex", flexDirection: "column", gap: "4px" } as const;
const TEMPLATE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const Header = ({
	model,
	onEdit,
}: {
	readonly model: Ready;
	readonly onEdit: OnEdit;
}) => (
	<>
		<h2 style={TITLE}>
			{nls.localize("mete/team/title", "Edit team")}: {model.team.metadata.id}
		</h2>
		<p style={MUTED}>
			{model.source === "builtIn"
				? nls.localize(
						"mete/team/builtIn",
						"A built-in team: Save writes your copy to .mete/teams/{0}.yaml, which METE then uses instead.",
						model.team.metadata.id,
					)
				: nls.localize(
						"mete/team/workspace",
						"This folder's team, saved in .mete/teams/{0}.yaml.",
						model.team.metadata.id,
					)}
		</p>
		<label style={FIELD}>
			{nls.localize("mete/team/name", "Team name")}
			<input
				className="mete-field"
				value={model.team.metadata.name}
				onChange={(e) => onEdit(["metadata", "name"], e.target.value)}
			/>
		</label>
		<label style={FIELD}>
			{nls.localize("mete/team/description", "Description (optional)")}
			<input
				className="mete-field"
				value={model.team.metadata.description ?? ""}
				onChange={(e) =>
					onEdit(
						["metadata", "description"],
						e.target.value.trim() ? e.target.value : undefined,
					)
				}
			/>
		</label>
	</>
);

const SaveAs = ({
	disabled,
	onSaveAs,
}: {
	readonly disabled: boolean;
	readonly onSaveAs: TeamEditorActions["onSaveAs"];
}) => {
	const [id, setId] = useState("");
	const [name, setName] = useState("");
	const ok = TEMPLATE_ID.test(id) && name.trim().length > 0 && !disabled;
	return (
		<div style={{ ...ROW, alignItems: "flex-end" }}>
			<label style={FIELD}>
				{nls.localize("mete/team/copyId", "New team id (such as my-web-team)")}
				<input
					className="mete-field"
					value={id}
					onChange={(e) => setId(e.target.value)}
				/>
			</label>
			<label style={FIELD}>
				{nls.localize("mete/team/copyName", "New team name")}
				<input
					className="mete-field"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</label>
			<button
				type="button"
				className="mete-button quiet"
				disabled={!ok}
				onClick={() => onSaveAs(id, name.trim())}
			>
				{nls.localize("mete/team/saveAs", "Save as new team")}
			</button>
		</div>
	);
};

const Issues = ({ issues }: { readonly issues: readonly string[] }) =>
	issues.length === 0 ? null : (
		<div role="alert">
			<p>{nls.localize("mete/team/issues", "Fix these before saving:")}</p>
			<ul>
				{issues.map((i) => (
					<li key={i}>{i}</li>
				))}
			</ul>
		</div>
	);

const Message = ({ children }: { readonly children: string }) => (
	<section style={PANEL}>
		<p>{children}</p>
	</section>
);

const Members = ({
	model,
	actions,
}: {
	readonly model: Ready;
	readonly actions: TeamEditorActions;
}) => {
	const hints = capabilityHints(model.team);
	return (
		<>
			<h3 style={TITLE}>{nls.localize("mete/team/members", "Members")}</h3>
			{model.team.roles.map((r, i) => (
				<MemberCard
					// biome-ignore lint/suspicious/noArrayIndexKey: two new members may share an id until the schema refuses it
					key={i}
					team={model.team}
					index={i}
					fixed={model.fixedIds.includes(r.id)}
					hints={hints}
					onEdit={actions.onEdit}
					onRemove={() => actions.onRemoveMember(i)}
					onAddTask={() => actions.onAddTask(r.id)}
					onRemoveTask={actions.onRemoveTask}
				/>
			))}
			<div style={ROW}>
				<button
					type="button"
					className="mete-button quiet"
					onClick={actions.onAddMember}
				>
					{nls.localize("mete/team/addMember", "Add member")}
				</button>
			</div>
		</>
	);
};

/** The team editor for a model and its actions. */
export const TeamEditorView = ({
	model,
	actions,
}: {
	readonly model: TeamEditorModel;
	readonly actions: TeamEditorActions;
}) => {
	if (model.kind === "no_folder") return <Message>{noFolderText()}</Message>;
	if (model.kind === "failed") return <Message>{model.text}</Message>;
	if (model.kind === "none")
		return (
			<Message>
				{nls.localize(
					"mete/team/none",
					"Choose a team to edit with METE: Edit team, or Edit beside a team in Start a run.",
				)}
			</Message>
		);
	if (model.kind === "loading")
		return (
			<Message>
				{nls.localize("mete/team/loading", "METE is reading the team…")}
			</Message>
		);
	const blocked = model.issues.length > 0 || model.busy;
	return (
		<section style={PANEL}>
			<Header model={model} onEdit={actions.onEdit} />
			<Members model={model} actions={actions} />
			<Issues issues={model.issues} />
			<div style={ROW}>
				<button
					type="button"
					className="mete-button"
					// A built-in team saves as it is too: the copy then opens in the YAML editor.
					disabled={blocked || (!model.changed && model.source === "workspace")}
					onClick={actions.onSave}
				>
					{nls.localize("mete/team/save", "Save")}
				</button>
				<button
					type="button"
					className="mete-button quiet"
					disabled={model.source !== "workspace"}
					onClick={actions.onOpenYaml}
				>
					{nls.localize("mete/team/openYaml", "Open YAML")}
				</button>
			</div>
			<SaveAs disabled={blocked} onSaveAs={actions.onSaveAs} />
		</section>
	);
};
