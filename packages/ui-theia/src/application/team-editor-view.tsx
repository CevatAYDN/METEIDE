import { nls } from "@theia/core/lib/common/nls";
import { PANEL } from "./look.js";
import { MemberCard } from "./member-card.js";
import { MemberGrid } from "./member-grid.js";
import { chainKey } from "./pins-draft.js";
import { Icon } from "./roster-look.js";
import { noFolderText } from "./status-text.js";
import { capabilityHints, guardrailHints } from "./team-draft.js";
import type {
	TeamEditorReady as Ready,
	TeamEditorActions,
	TeamEditorModel,
} from "./team-editor-model.js";
import { TeamHero } from "./team-hero.js";
import { OrderOfWork } from "./work-order-view.js";

export type {
	TeamEditorActions,
	TeamEditorModel,
} from "./team-editor-model.js";

// The team editor's screen (docs/13, Settings, Templates; ADR-075): the hero band (team, its name and
// description, its limits, Save, Save as new team and Open YAML, and the schema's issues) over the
// members with their tasks. The view holds no state: the widget passes the draft and the actions.

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
		<div className="mete-team-members">
			<div className="mete-team-side">
				<h3>
					<Icon name="account" />
					{nls.localize("mete/team/members", "Members")}
				</h3>
				<MemberGrid
					team={model.team}
					selected={i}
					onSelect={actions.onSelectMember}
					onAdd={actions.onAddMember}
				/>
				<OrderOfWork team={model.team} onSelect={actions.onSelectMember} />
			</div>
			{r ? (
				<div className="mete-team-form">
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
						draft={model.draft}
						onDraft={actions.onDraft}
					/>
				</div>
			) : null}
		</div>
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
	return (
		<section className="mete-team">
			<TeamHero model={model} actions={actions} />
			<Members model={model} actions={actions} />
		</section>
	);
};
