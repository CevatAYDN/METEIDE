import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import type { OnEdit } from "./fields.js";
import { MUTED, PANEL, ROW, TITLE } from "./look.js";
import { MemberCard } from "./member-card.js";
import { MemberGrid } from "./member-grid.js";
import { chainKey } from "./pins-draft.js";
import { noFolderText } from "./status-text.js";
import {
	capabilityHints,
	guardrailHints,
	type TeamView,
} from "./team-draft.js";
import { TeamRules } from "./work-fields.js";
import { OrderOfWork } from "./work-order-view.js";

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
			/** The member whose form shows beside the grid (ADR-093). */
			readonly selected: number;
			/** This team's pins in the folder, by member id (ADR-077). */
			readonly pins: Readonly<Record<string, string>>;
			/** `<providerId>/<modelId>` of each tier's chain, by chainKey. */
			readonly chains: Readonly<Record<string, readonly string[]>>;
	  };

/** What the screen's buttons do. */
export type TeamEditorActions = {
	readonly onEdit: OnEdit;
	readonly onSelectMember: (index: number) => void;
	readonly onAddMember: () => void;
	readonly onRemoveMember: (index: number) => void;
	readonly onRenameMember: (index: number, id: string) => void;
	/** Pins a member's model in this folder, or clears it given undefined (ADR-077). */
	readonly onPin: (roleId: string, value: string | undefined) => void;
	readonly onAddTask: (roleId: string) => void;
	readonly onRemoveTask: (index: number) => void;
	readonly onSave: () => void;
	readonly onSaveAs: (id: string, name: string) => void;
	readonly onOpenYaml: () => void;
};

type Ready = Extract<TeamEditorModel, { kind: "ready" }>;

const FIELD = { display: "flex", flexDirection: "column", gap: "4px" } as const;
const COLUMN = {
	display: "flex",
	flexDirection: "column",
	gap: "14px",
} as const;
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
	const i = model.selected;
	const r = model.team.roles[i];
	return (
		<>
			<h3 style={TITLE}>{nls.localize("mete/team/members", "Members")}</h3>
			<div style={{ ...ROW, alignItems: "flex-start" }}>
				<div style={{ ...COLUMN, flex: "1 1 280px", minWidth: 0 }}>
					<MemberGrid
						team={model.team}
						selected={i}
						onSelect={actions.onSelectMember}
						onAdd={actions.onAddMember}
					/>
					<OrderOfWork team={model.team} onSelect={actions.onSelectMember} />
				</div>
				{r ? (
					<div style={{ flex: "2 1 420px", minWidth: 0 }}>
						{/* Keyed by place, so a field's half-typed text never moves to another member. */}
						<MemberCard
							key={i}
							team={model.team}
							index={i}
							fixed={model.fixedIds.includes(r.id)}
							hints={capabilityHints(model.team)}
							outputs={guardrailHints(model.team)}
							onEdit={actions.onEdit}
							onRemove={() => actions.onRemoveMember(i)}
							onRename={(id) => actions.onRenameMember(i, id)}
							pin={{
								...(model.pins[r.id] ? { value: model.pins[r.id] } : {}),
								models: model.chains[chainKey(r.tier, r.needs)] ?? [],
							}}
							onPin={(v) => actions.onPin(r.id, v)}
							onAddTask={() => actions.onAddTask(r.id)}
							onRemoveTask={actions.onRemoveTask}
						/>
					</div>
				) : null}
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
			<TeamRules team={model.team} onEdit={actions.onEdit} />
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
