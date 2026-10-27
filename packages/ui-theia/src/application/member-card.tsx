import { NeedSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import { Chips, type OnEdit, orEmpty, orNone, Text, Ticks } from "./fields.js";
import { SpawnDefaults, TaskRow } from "./member-tasks.js";
import { PinField } from "./pin-field.js";
import { Icon } from "./roster-look.js";
import type { MemberView, TeamView } from "./team-draft.js";
import { TierTiles } from "./tier-tiles.js";

// One member of the team editor (ADR-075, ADR-128): the head with its face, Draft with a model and
// Remove, its fields, tier, needs and pin, what it may use, and the tasks that name it. Every change
// goes out as a path in the template and a value; a blank optional field goes out as undefined, so
// the key leaves the file. Laid out by style/mete-team-form.css.

type MemberProps = {
	readonly team: TeamView;
	readonly index: number;
	/** Whether the member came with the file: its id is then fixed, as tasks may name it. */
	readonly fixed: boolean;
	readonly hints: readonly string[];
	readonly onRename: (id: string) => void;
	/** The member's pinned model in this folder, and the models its tier offers (ADR-077). */
	readonly pin: { readonly value?: string; readonly models: readonly string[] };
	readonly onPin: (value: string | undefined) => void;
	/** Artifact types with a schema, offered as guardrails. */
	readonly outputs: readonly string[];
	readonly onEdit: OnEdit;
	readonly onRemove: () => void;
	readonly onAddTask: () => void;
	readonly onRemoveTask: (index: number) => void;
	/** The member's model draft: busy while it runs, what it filled, a note when it failed (ADR-108). */
	readonly draft: {
		readonly busy: boolean;
		readonly filled: "both" | "goal" | "none";
		readonly note?: string;
		readonly sources: readonly string[];
	};
	readonly onDraft: () => void;
};

type Path = (key: string) => readonly (string | number)[];

// The id is renamed when the field is left or Enter is pressed, so a half-typed id never takes over
// another member's tasks; an id another member has is refused and the field shows the old one again.
const IdField = (props: {
	readonly id: string;
	readonly fixed: boolean;
	readonly onRename: (id: string) => void;
}) => {
	const [draft, setDraft] = useState(props.id);
	const commit = () => {
		if (draft !== props.id) props.onRename(draft);
		setDraft(props.id);
	};
	return (
		<label>
			{nls.localize("mete/team/memberId", "Id")}
			<span className="mete-locked">
				<input
					className="mete-field mono"
					value={draft}
					disabled={props.fixed}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") commit();
					}}
					onBlur={commit}
				/>
				{props.fixed ? <Icon name="lock" /> : null}
			</span>
		</label>
	);
};

const Fields = ({
	member,
	at,
	onEdit,
	fixed,
	onRename,
}: {
	readonly member: MemberView;
	readonly at: Path;
	readonly onEdit: OnEdit;
	readonly fixed: boolean;
	readonly onRename: (id: string) => void;
}) => (
	<div className="mete-member-fields">
		<IdField key={member.id} id={member.id} fixed={fixed} onRename={onRename} />
		<Text
			label={nls.localize("mete/team/memberName", "Name")}
			value={member.name}
			onChange={(v) => onEdit(at("name"), v)}
		/>
		<Text
			label={nls.localize("mete/team/goal", "Goal")}
			rows={3}
			wide
			value={member.goal}
			onChange={(v) => onEdit(at("goal"), v)}
		/>
		<Text
			label={nls.localize("mete/team/backstory", "Backstory (optional)")}
			rows={2}
			wide
			value={member.backstory ?? ""}
			onChange={(v) => onEdit(at("backstory"), orNone(v))}
		/>
	</div>
);

// What a member may use and what wakes it: its capabilities, the families it avoids, its artifacts.
const Reach = ({
	member,
	others,
	hints,
	at,
	onEdit,
}: {
	readonly member: MemberView;
	readonly others: readonly string[];
	readonly hints: readonly string[];
	readonly at: Path;
	readonly onEdit: OnEdit;
}) => (
	<div className="mete-reach">
		<Chips
			label={nls.localize(
				"mete/team/capabilities",
				"Capabilities (ids such as fs.read@1)",
			)}
			values={member.capabilities}
			hints={hints}
			onChange={(v) => onEdit(at("capabilities"), v)}
		/>
		<div className="mete-reach-pair">
			<Ticks
				label={nls.localize(
					"mete/team/otherFamily",
					"Prefer a different model family than",
				)}
				options={others}
				values={member.prefer_different_family_than}
				onChange={(v) => onEdit(at("prefer_different_family_than"), orEmpty(v))}
			/>
			<Chips
				label={nls.localize(
					"mete/team/watches",
					"Wakes on artifacts (such as gdd@1)",
				)}
				values={member.watches}
				hints={[]}
				onChange={(v) => onEdit(at("watches"), orEmpty(v))}
			/>
		</div>
	</div>
);

const IdleNote = () => (
	<p className="mete-member-note" role="note">
		{nls.localize(
			"mete/team/idle",
			"No task names this member yet, so it works only when a task list gives it one. Add a task to give it work.",
		)}
	</p>
);

// The Draft note (ADR-108): which fields the draft filled, and the pages it read. The answer lands
// in the form for review; nothing is written until Save.
const DraftNote = ({ draft }: { readonly draft: MemberProps["draft"] }) => {
	const text =
		draft.filled === "both"
			? nls.localize(
					"mete/team/draftDoneBoth",
					"Goal and backstory drafted — review them, then save.",
				)
			: draft.filled === "goal"
				? nls.localize(
						"mete/team/draftDoneGoal",
						"Goal drafted — review it, then save.",
					)
				: undefined;
	if (!draft.busy && !text && !draft.note && draft.sources.length === 0)
		return null;
	return (
		<p className="mete-member-note">
			{draft.busy ? (
				<span>{nls.localize("mete/team/drafting", "Drafting…")}</span>
			) : null}
			{text ? <span role="status">{text}</span> : null}
			{draft.note ? <span role="alert">{draft.note}</span> : null}
			{draft.sources.length > 0 ? (
				<span>{draft.sources.join(" · ")}</span>
			) : null}
		</p>
	);
};

// The head: the member's face and name, Draft with a model (ADR-108) and Remove.
const Head = (props: {
	readonly name: string;
	readonly draft: MemberProps["draft"];
	readonly onDraft: () => void;
	readonly onRemove: () => void;
}) => (
	<div className="mete-member-title">
		<span className="mete-member-face" aria-hidden="true">
			<span>{props.name.slice(0, 1).toUpperCase()}</span>
		</span>
		<h3>{props.name}</h3>
		<button
			type="button"
			className="mete-button quiet"
			disabled={props.draft.busy}
			onClick={props.onDraft}
		>
			<Icon name="sparkle" />
			{nls.localize("mete/team/draft", "Draft with a model")}
		</button>
		<button
			type="button"
			className="mete-button quiet ghost"
			onClick={props.onRemove}
		>
			<Icon name="trash" />
			{nls.localize("mete/team/removeMember", "Remove member")}
		</button>
	</div>
);

// The tasks that name the member, the defaults a task list gives it, and the button that adds one.
const Tasks = (props: {
	readonly team: TeamView;
	readonly member: MemberView;
	readonly tasks: readonly number[];
	readonly outputs: readonly string[];
	readonly onEdit: OnEdit;
	readonly onAdd: () => void;
	readonly onRemove: (index: number) => void;
}) => (
	<>
		{props.tasks.length === 0 ? <IdleNote /> : null}
		{props.tasks.map((i) => (
			<TaskRow
				key={i}
				team={props.team}
				index={i}
				hints={props.outputs}
				onEdit={props.onEdit}
				onRemove={() => props.onRemove(i)}
			/>
		))}
		<SpawnDefaults
			team={props.team}
			id={props.member.id}
			hints={props.outputs}
			onEdit={props.onEdit}
		/>
		<div>
			<button type="button" className="mete-button quiet" onClick={props.onAdd}>
				<Icon name="add" />
				{nls.localize("mete/team/addTask", "Add a task for this member")}
			</button>
		</div>
	</>
);

/** A member's card: its fields, then its tasks, with the note when no task names it. */
export const MemberCard = (props: MemberProps) => {
	const { team, index, onEdit } = props;
	const member = team.roles[index];
	if (!member) return null;
	const at: Path = (key) => ["roles", index, key] as const;
	const others = team.roles.map((r) => r.id).filter((id) => id !== member.id);
	const tasks = team.tasks.flatMap((t, i) => (t.role === member.id ? [i] : []));
	const name = member.name || member.id;
	return (
		<section className="mete-member-form" aria-label={name}>
			<Head
				name={name}
				draft={props.draft}
				onDraft={props.onDraft}
				onRemove={props.onRemove}
			/>
			<DraftNote draft={props.draft} />
			<Fields
				member={member}
				at={at}
				onEdit={onEdit}
				fixed={props.fixed}
				onRename={props.onRename}
			/>
			<TierTiles value={member.tier} onEdit={(v) => onEdit(at("tier"), v)} />
			<div className="mete-member-pair">
				<Ticks
					label={nls.localize("mete/team/needs", "Needs")}
					options={NeedSchema.options}
					values={member.needs}
					onChange={(v) => onEdit(at("needs"), orEmpty(v))}
				/>
				<PinField fixed={props.fixed} {...props.pin} onPin={props.onPin} />
			</div>
			<span className="mete-member-rule" aria-hidden="true" />
			<Reach
				member={member}
				others={others}
				hints={props.hints}
				at={at}
				onEdit={onEdit}
			/>
			<Tasks
				team={team}
				member={member}
				tasks={tasks}
				outputs={props.outputs}
				onEdit={onEdit}
				onAdd={props.onAddTask}
				onRemove={props.onRemoveTask}
			/>
		</section>
	);
};
