import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import type { OnEdit } from "./fields.js";
import { Icon } from "./roster-look.js";
import { TEMPLATE_ID } from "./team-draft.js";
import type {
	TeamEditorReady as Ready,
	TeamEditorActions,
} from "./team-editor-model.js";
import { TeamRules } from "./work-fields.js";

// The team editor's hero band in the design set's look (ADR-128): which team, with Open YAML and Save
// beside the title (ADR-093: Save, Open YAML and Save as new team stand above the grid), where the
// team saves, what blocks Save, its name and description, a copy under another id, and its revision
// limit and budget at the right. Laid out by style/mete-team.css.

const SOURCE_TEXT = (id: string) => ({
	builtIn: nls.localize(
		"mete/team/builtIn",
		"A built-in team: Save writes your copy to .mete/teams/{0}.yaml, which METE then uses instead.",
		id,
	),
	workspace: nls.localize(
		"mete/team/workspace",
		"This folder's team, saved in .mete/teams/{0}.yaml.",
		id,
	),
	new: nls.localize(
		"mete/team/newTeam",
		"A new team: Save writes it to .mete/teams/{0}.yaml.",
		id,
	),
});

const Issues = ({ issues }: { readonly issues: readonly string[] }) =>
	issues.length === 0 ? null : (
		<div className="mete-team-issues" role="alert">
			<p>
				<Icon name="warning" />
				{nls.localize("mete/team/issues", "Fix these before saving:")}
			</p>
			<ul>
				{issues.map((i) => (
					<li key={i}>{i}</li>
				))}
			</ul>
		</div>
	);

// The title row: the tile, the team's id, Open YAML and Save.
const Headline = ({
	model,
	actions,
}: {
	readonly model: Ready;
	readonly actions: TeamEditorActions;
}) => {
	const blocked = model.issues.length > 0 || model.busy;
	return (
		<div className="mete-team-headline">
			<span className="mete-team-tile">
				<Icon name="organization" />
			</span>
			<div className="mete-team-title">
				<h2>
					{nls.localize("mete/team/title", "Edit team")}:{" "}
					<span className="mete-team-id">{model.team.metadata.id}</span>
				</h2>
				<p>{nls.localize("mete/team/caption", "METE: edit a team")}</p>
			</div>
			<button
				type="button"
				className="mete-button quiet"
				disabled={model.source !== "workspace"}
				onClick={actions.onOpenYaml}
			>
				<Icon name="file" />
				{nls.localize("mete/team/openYaml", "Open YAML")}
			</button>
			<button
				type="button"
				className="mete-button"
				// A built-in team saves as it is too: the copy then opens in the YAML editor.
				disabled={blocked || (!model.changed && model.source === "workspace")}
				onClick={actions.onSave}
			>
				<Icon name="save" />
				{nls.localize("mete/team/save", "Save")}
			</button>
		</div>
	);
};

const Names = ({
	model,
	onEdit,
}: {
	readonly model: Ready;
	readonly onEdit: OnEdit;
}) => (
	<div className="mete-team-names">
		<label>
			{nls.localize("mete/team/name", "Team name")}
			<input
				className="mete-field strong"
				value={model.team.metadata.name}
				onChange={(e) => onEdit(["metadata", "name"], e.target.value)}
			/>
		</label>
		<label>
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
	</div>
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
		<div className="mete-team-copy">
			<label>
				{nls.localize("mete/team/copyId", "New team id (such as my-web-team)")}
				<input
					className="mete-field mono"
					value={id}
					onChange={(e) => setId(e.target.value)}
				/>
			</label>
			<label>
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
				<Icon name="copy" />
				{nls.localize("mete/team/saveAs", "Save as new team")}
			</button>
		</div>
	);
};

/** The hero band for a team that is ready to edit. */
export const TeamHero = ({
	model,
	actions,
}: {
	readonly model: Ready;
	readonly actions: TeamEditorActions;
}) => (
	<header className="mete-team-hero">
		<div className="mete-team-intro">
			<Headline model={model} actions={actions} />
			<p className="mete-team-source">
				{SOURCE_TEXT(model.team.metadata.id)[model.source]}
			</p>
			<Issues issues={model.issues} />
			<Names model={model} onEdit={actions.onEdit} />
			{model.source === "new" ? null : (
				<SaveAs
					disabled={model.issues.length > 0 || model.busy}
					onSaveAs={actions.onSaveAs}
				/>
			)}
		</div>
		<TeamRules team={model.team} onEdit={actions.onEdit} />
	</header>
);
