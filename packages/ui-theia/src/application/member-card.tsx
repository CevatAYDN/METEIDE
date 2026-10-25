import { NeedSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useState } from "react";
import {
	Chips,
	FIELD,
	type OnEdit,
	orEmpty,
	orNone,
	Text,
	Tick,
	Ticks,
} from "./fields.js";
import { MUTED, ROW } from "./look.js";
import { PinField } from "./pin-field.js";
import { type MemberView, type TeamView, toggled } from "./team-draft.js";
import { TierTiles } from "./tier-tiles.js";
import { Work } from "./work-fields.js";

// One member of the team editor (ADR-075): its fields, the tasks that name it and the buttons that
// add or remove them. Every change goes out as a path in the template and a value; a blank optional
// field goes out as undefined, so the key leaves the file.

type TaskProps = {
	readonly team: TeamView;
	readonly index: number;
	readonly hints: readonly string[];
	readonly onEdit: OnEdit;
	readonly onRemove: () => void;
};

// The human after the approver role (policies.human_checkpoints); an approver "You" or none says
// the rest, so the tick shows only for a role, or when the file already has it.
const Checkpoint = ({
	team,
	index,
	onEdit,
}: Omit<TaskProps, "onRemove" | "hints">) => {
	const task = team.tasks[index];
	const list = team.policies.human_checkpoints;
	const on = !!task && list.includes(task.id);
	if (!task || !(on || (task.approval && task.approval !== "human")))
		return null;
	return (
		<Tick
			label={nls.localize(
				"mete/team/checkpoint",
				"You approve it too, after the approver",
			)}
			checked={on}
			onChange={(c) =>
				onEdit(
					["policies", "human_checkpoints"],
					orEmpty(toggled(list, task.id, c)),
				)
			}
		/>
	);
};

/** One task that names the member: its title, its work, what it waits for, and the human's part. */
const TaskRow = ({ team, index, hints, onEdit, onRemove }: TaskProps) => {
	const task = team.tasks[index];
	if (!task) return null;
	const at = (key: string) => ["tasks", index, key] as const;
	const others = team.tasks.map((t) => t.id).filter((id) => id !== task.id);
	return (
		<div className="mete-card" style={{ ...FIELD, gap: "8px" }}>
			<div style={ROW}>
				<strong>{task.id}</strong>
				<button type="button" className="mete-button quiet" onClick={onRemove}>
					{nls.localize("mete/team/removeTask", "Remove task")}
				</button>
			</div>
			<Text
				label={nls.localize("mete/team/taskTitle", "Title")}
				value={task.title}
				onChange={(v) => onEdit(at("title"), v)}
			/>
			<Work
				team={team}
				work={task}
				base={["tasks", index]}
				hints={hints}
				onEdit={onEdit}
			/>
			<Checkpoint team={team} index={index} onEdit={onEdit} />
			<Chips
				label={nls.localize("mete/team/context", "Waits for the tasks")}
				values={task.context}
				hints={others}
				onChange={(v) => onEdit(at("context"), orEmpty(v))}
			/>
			<Tick
				label={nls.localize(
					"mete/team/spawns",
					"Its approved task list (task-list@1) becomes tasks for the members it names",
				)}
				checked={task.spawns}
				onChange={(c) => onEdit(at("spawns"), c || undefined)}
			/>
		</div>
	);
};

// What a task list gives this member: the defaults of each task it becomes, shown once a task spawns.
const SpawnDefaults = (props: {
	readonly team: TeamView;
	readonly id: string;
	readonly hints: readonly string[];
	readonly onEdit: OnEdit;
}) =>
	props.id && props.team.tasks.some((t) => t.spawns) ? (
		<div className="mete-card" style={{ ...FIELD, gap: "8px" }}>
			<strong>
				{nls.localize(
					"mete/team/spawnDefaults",
					"Tasks a task list gives this member",
				)}
			</strong>
			<Work
				team={props.team}
				work={props.team.spawn_defaults[props.id] ?? { verify: [] }}
				base={["spawn_defaults", props.id]}
				hints={props.hints}
				onEdit={props.onEdit}
			/>
		</div>
	) : null;

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
		<label style={FIELD}>
			{nls.localize("mete/team/memberId", "Id")}
			<input
				className="mete-field"
				value={draft}
				disabled={props.fixed}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
				}}
				onBlur={commit}
			/>
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
	readonly at: (key: string) => readonly (string | number)[];
	readonly onEdit: OnEdit;
	readonly fixed: boolean;
	readonly onRename: (id: string) => void;
}) => (
	<>
		<div style={{ ...ROW, alignItems: "flex-end" }}>
			<IdField
				key={member.id}
				id={member.id}
				fixed={fixed}
				onRename={onRename}
			/>
			<Text
				label={nls.localize("mete/team/memberName", "Name")}
				value={member.name}
				onChange={(v) => onEdit(at("name"), v)}
			/>
		</div>
		<Text
			label={nls.localize("mete/team/goal", "Goal")}
			rows={3}
			value={member.goal}
			onChange={(v) => onEdit(at("goal"), v)}
		/>
		<Text
			label={nls.localize("mete/team/backstory", "Backstory (optional)")}
			rows={2}
			value={member.backstory ?? ""}
			onChange={(v) => onEdit(at("backstory"), orNone(v))}
		/>
		<TierTiles value={member.tier} onEdit={(v) => onEdit(at("tier"), v)} />
		<Ticks
			label={nls.localize("mete/team/needs", "Needs")}
			options={NeedSchema.options}
			values={member.needs}
			onChange={(v) => onEdit(at("needs"), orEmpty(v))}
		/>
	</>
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
	readonly at: (key: string) => readonly (string | number)[];
	readonly onEdit: OnEdit;
}) => (
	<>
		<Chips
			label={nls.localize(
				"mete/team/capabilities",
				"Capabilities (ids such as fs.read@1)",
			)}
			values={member.capabilities}
			hints={hints}
			onChange={(v) => onEdit(at("capabilities"), v)}
		/>
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
	</>
);

const IdleNote = () => (
	<p style={MUTED} role="note">
		{nls.localize(
			"mete/team/idle",
			"No task names this member yet, so it works only when a task list gives it one. Add a task to give it work.",
		)}
	</p>
);

// The Draft row (ADR-108): one button asks a model for this member's fields, and the answer lands
// in the form for review; nothing is written until Save. The note says which fields the draft
// filled, and the pages it read show beside it.
const DraftRow = (props: {
	readonly draft: MemberProps["draft"];
	readonly onDraft: () => void;
}) => (
	<div style={{ ...ROW, flexWrap: "wrap", gap: "8px" }}>
		<button
			type="button"
			className="mete-button quiet"
			disabled={props.draft.busy}
			onClick={props.onDraft}
		>
			{nls.localize("mete/team/draft", "Draft with a model")}
		</button>
		{props.draft.busy ? (
			<span style={MUTED}>
				{nls.localize("mete/team/drafting", "Drafting…")}
			</span>
		) : null}
		{props.draft.filled === "both" ? (
			<span style={MUTED} role="status">
				{nls.localize(
					"mete/team/draftDoneBoth",
					"Goal and backstory drafted — review them, then save.",
				)}
			</span>
		) : null}
		{props.draft.filled === "goal" ? (
			<span style={MUTED} role="status">
				{nls.localize(
					"mete/team/draftDoneGoal",
					"Goal drafted — review it, then save.",
				)}
			</span>
		) : null}
		{props.draft.note ? (
			<span style={MUTED} role="alert">
				{props.draft.note}
			</span>
		) : null}
		{props.draft.sources.length > 0 ? (
			<span style={MUTED}>{props.draft.sources.join(" · ")}</span>
		) : null}
	</div>
);

const Head = (props: {
	readonly name: string;
	readonly onRemove: () => void;
}) => (
	<div style={ROW}>
		<strong>{props.name}</strong>
		<button
			type="button"
			className="mete-button quiet"
			onClick={props.onRemove}
		>
			{nls.localize("mete/team/removeMember", "Remove member")}
		</button>
	</div>
);

/** A member's card: its fields, then its tasks, with the note when no task names it. */
export const MemberCard = (props: MemberProps) => {
	const { team, index, onEdit } = props;
	const member = team.roles[index];
	if (!member) return null;
	const at = (key: string) => ["roles", index, key] as const;
	const others = team.roles.map((r) => r.id).filter((id) => id !== member.id);
	const tasks = team.tasks.flatMap((t, i) => (t.role === member.id ? [i] : []));
	return (
		<section className="mete-card" style={{ ...FIELD, gap: "10px" }}>
			<Head name={member.name || member.id} onRemove={props.onRemove} />
			<Fields
				member={member}
				at={at}
				onEdit={onEdit}
				fixed={props.fixed}
				onRename={props.onRename}
			/>
			<DraftRow draft={props.draft} onDraft={props.onDraft} />
			<PinField fixed={props.fixed} {...props.pin} onPin={props.onPin} />
			<Reach
				member={member}
				others={others}
				hints={props.hints}
				at={at}
				onEdit={onEdit}
			/>
			{tasks.length === 0 ? <IdleNote /> : null}
			{tasks.map((i) => (
				<TaskRow
					key={i}
					team={team}
					index={i}
					hints={props.outputs}
					onEdit={onEdit}
					onRemove={() => props.onRemoveTask(i)}
				/>
			))}
			<SpawnDefaults
				team={team}
				id={member.id}
				hints={props.outputs}
				onEdit={onEdit}
			/>
			<div style={ROW}>
				<button
					type="button"
					className="mete-button quiet"
					onClick={props.onAddTask}
				>
					{nls.localize("mete/team/addTask", "Add a task for this member")}
				</button>
			</div>
		</section>
	);
};
