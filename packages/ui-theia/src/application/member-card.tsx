import { NeedSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useId, useState } from "react";
import type { PickerFacts } from "./composer.js";
import { Chips, type OnEdit, orEmpty, orNone, Text, Ticks } from "./fields.js";
import { type MemberSection, MemberSections } from "./member-sections.js";
import { SpawnDefaults, TaskRow } from "./member-tasks.js";
import { PinField } from "./pin-field.js";
import { Icon } from "./roster-look.js";
import type { MemberView, TeamView } from "./team-draft.js";
import { TierTiles } from "./tier-tiles.js";

// Selected-member form (ADR-192); edits retain their existing template paths and optional values.

type MemberProps = {
	readonly team: TeamView;
	readonly index: number;
	readonly selection?: {
		readonly section: MemberSection;
		readonly onSelect: (section: MemberSection) => void;
	};
	/** Whether the member came with the file: its id is then fixed, as tasks may name it. */
	readonly fixed: boolean;
	readonly hints: readonly string[];
	readonly onRename: (id: string) => void;
	/** The member's pinned model in this folder, the models its tier offers (ADR-077) and their facts (ADR-161). */
	readonly pin: {
		readonly value?: string;
		readonly models: readonly string[];
		readonly picker?: PickerFacts | undefined;
	};
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

// Commit ids on blur/Enter; a half-typed or duplicate id never takes over another member's tasks.
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
}: Pick<MemberProps, "onEdit" | "fixed" | "onRename"> & {
	readonly member: MemberView;
	readonly at: Path;
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

// Unwired family preferences and watches remain inspectable without leading the ordinary form.
const Reach = ({
	member,
	hints,
	at,
	onEdit,
}: {
	readonly member: MemberView;
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
		<details className="mete-member-advanced">
			<summary>{nls.localize("mete/team/memberAdvanced", "Advanced")}</summary>
			<Text
				label={nls.localize(
					"mete/team/otherFamilyInactive",
					"Model family preference (not active)",
				)}
				value={member.prefer_different_family_than.join(", ")}
				disabled
				onChange={() => {}}
			/>
			<Text
				label={nls.localize(
					"mete/team/watchesInactive",
					"Artifact watches (not active)",
				)}
				value={member.watches.join(", ")}
				disabled
				onChange={() => {}}
			/>
		</details>
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

// Draft output stays pending review until Save (ADR-108).
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

const Head = (
	props: Pick<MemberProps, "draft" | "onDraft" | "onRemove"> & {
		readonly name: string;
	},
) => (
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

const memberDetails = (props: MemberProps, member: MemberView, at: Path) => (
	<>
		<Fields
			member={member}
			at={at}
			onEdit={props.onEdit}
			fixed={props.fixed}
			onRename={props.onRename}
		/>
		<TierTiles
			value={member.tier}
			onEdit={(v) => props.onEdit(at("tier"), v)}
		/>
		<div className="mete-member-pair">
			<Ticks
				label={nls.localize("mete/team/needs", "Needs")}
				options={NeedSchema.options}
				values={member.needs}
				onChange={(v) => props.onEdit(at("needs"), orEmpty(v))}
			/>
			<PinField fixed={props.fixed} {...props.pin} onPin={props.onPin} />
		</div>
		<span className="mete-member-rule" aria-hidden="true" />
		<Reach member={member} hints={props.hints} at={at} onEdit={props.onEdit} />
	</>
);

/** A selected member's retained Member and Tasks views (ADR-192). */
export const MemberCard = (props: MemberProps) => {
	const [selected, onSelect] = useState<MemberSection>("member");
	const id = useId();
	const { team, index, onEdit } = props;
	const member = team.roles[index];
	if (!member) return null;
	const at: Path = (key) => ["roles", index, key] as const;
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
			<MemberSections
				id={id}
				selected={props.selection?.section ?? selected}
				onSelect={props.selection?.onSelect ?? onSelect}
				member={memberDetails(props, member, at)}
				tasks={
					<Tasks
						team={team}
						member={member}
						tasks={tasks}
						outputs={props.outputs}
						onEdit={onEdit}
						onAdd={props.onAddTask}
						onRemove={props.onRemoveTask}
					/>
				}
			/>
		</section>
	);
};
