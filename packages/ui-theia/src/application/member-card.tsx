import { NeedSchema, TierSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useId, useState } from "react";
import { MUTED, ROW } from "./look.js";
import type { MemberView, TeamView } from "./team-draft.js";

// One member of the team editor (ADR-075): its fields, the tasks that name it and the buttons that
// add or remove them. Every change goes out as a path in the template and a value; a blank optional
// field goes out as undefined, so the key leaves the file.

/** A change at a path of the template; undefined removes the key. */
export type OnEdit = (
	path: readonly (string | number)[],
	value: unknown,
) => void;

const FIELD = { display: "flex", flexDirection: "column", gap: "4px" } as const;
const orNone = (v: string) => (v.trim() ? v : undefined);
const orEmpty = (v: readonly string[]) => (v.length > 0 ? v : undefined);

/** A list of ids as removable chips, with a field that adds one, offering `hints`. */
export const Chips = (props: {
	readonly label: string;
	readonly values: readonly string[];
	readonly hints: readonly string[];
	readonly onChange: (values: readonly string[]) => void;
}) => {
	const [draft, setDraft] = useState("");
	const list = useId();
	const add = () => {
		const v = draft.trim();
		if (v && !props.values.includes(v)) props.onChange([...props.values, v]);
		setDraft("");
	};
	return (
		<div style={FIELD}>
			<span>{props.label}</span>
			<div style={ROW}>
				{props.values.map((v) => (
					<button
						key={v}
						type="button"
						className="mete-button quiet"
						title={nls.localize("mete/team/removeChip", "Remove {0}", v)}
						onClick={() => props.onChange(props.values.filter((x) => x !== v))}
					>
						{v} ×
					</button>
				))}
				<input
					className="mete-field"
					style={{ width: "14em" }}
					list={list}
					value={draft}
					aria-label={props.label}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") add();
					}}
					onBlur={add}
				/>
				<datalist id={list}>
					{props.hints.map((h) => (
						<option key={h} value={h} />
					))}
				</datalist>
			</div>
		</div>
	);
};

const Text = (props: {
	readonly label: string;
	readonly value: string;
	readonly rows?: number;
	readonly disabled?: boolean;
	readonly onChange: (value: string) => void;
}) =>
	props.rows ? (
		<label style={FIELD}>
			{props.label}
			<textarea
				className="mete-field"
				rows={props.rows}
				value={props.value}
				onChange={(e) => props.onChange(e.target.value)}
			/>
		</label>
	) : (
		<label style={FIELD}>
			{props.label}
			<input
				className="mete-field"
				value={props.value}
				disabled={props.disabled}
				onChange={(e) => props.onChange(e.target.value)}
			/>
		</label>
	);

const Ticks = (props: {
	readonly label: string;
	readonly options: readonly string[];
	readonly values: readonly string[];
	readonly onChange: (values: readonly string[]) => void;
}) => (
	<fieldset style={{ border: "none", padding: 0, margin: 0 }}>
		<legend>{props.label}</legend>
		<div style={ROW}>
			{props.options.map((o) => (
				<label key={o} style={ROW}>
					<input
						type="checkbox"
						checked={props.values.includes(o)}
						onChange={(e) =>
							props.onChange(
								e.target.checked
									? [...props.values, o]
									: props.values.filter((v) => v !== o),
							)
						}
					/>
					{o}
				</label>
			))}
		</div>
	</fieldset>
);

const Tier = (props: {
	readonly value: string;
	readonly onEdit: (v: string) => void;
}) => (
	<label style={FIELD}>
		{nls.localize("mete/team/tier", "Model tier")}
		<select
			className="mete-field"
			value={props.value}
			onChange={(e) => props.onEdit(e.target.value)}
		>
			{TierSchema.options.map((t) => (
				<option key={t} value={t}>
					{t}
				</option>
			))}
		</select>
		<span style={MUTED}>
			{nls.localize(
				"mete/team/tierHint",
				"A team names a tier, never a provider or model: the providers that serve each tier come from the gateway settings.",
			)}
		</span>
	</label>
);

type TaskProps = {
	readonly team: TeamView;
	readonly index: number;
	readonly onEdit: OnEdit;
	readonly onRemove: () => void;
};

/** One task that names the member: its title, expected output, approver and context. */
const TaskRow = ({ team, index, onEdit, onRemove }: TaskProps) => {
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
			<Text
				label={nls.localize(
					"mete/team/output",
					"Expected output (artifact:<type>@<version>, optional)",
				)}
				value={task.expected_output ?? ""}
				onChange={(v) => onEdit(at("expected_output"), orNone(v))}
			/>
			<label style={FIELD}>
				{nls.localize("mete/team/approval", "Approved by")}
				<select
					className="mete-field"
					value={task.approval ?? ""}
					onChange={(e) => onEdit(at("approval"), orNone(e.target.value))}
				>
					<option value="">
						{nls.localize("mete/team/noApproval", "No approval")}
					</option>
					<option value="human">
						{nls.localize("mete/team/human", "You")}
					</option>
					{team.roles.map((r) => (
						<option key={r.id} value={r.id}>
							{r.name || r.id}
						</option>
					))}
				</select>
			</label>
			<Chips
				label={nls.localize("mete/team/context", "Waits for the tasks")}
				values={task.context}
				hints={others}
				onChange={(v) => onEdit(at("context"), orEmpty(v))}
			/>
		</div>
	);
};

type MemberProps = {
	readonly team: TeamView;
	readonly index: number;
	/** Whether the member came with the file: its id is then fixed, as tasks may name it. */
	readonly fixed: boolean;
	readonly hints: readonly string[];
	readonly onEdit: OnEdit;
	readonly onRemove: () => void;
	readonly onAddTask: () => void;
	readonly onRemoveTask: (index: number) => void;
};

const Fields = ({
	member,
	at,
	onEdit,
	fixed,
}: {
	readonly member: MemberView;
	readonly at: (key: string) => readonly (string | number)[];
	readonly onEdit: OnEdit;
	readonly fixed: boolean;
}) => (
	<>
		<div style={{ ...ROW, alignItems: "flex-end" }}>
			<Text
				label={nls.localize("mete/team/memberId", "Id")}
				value={member.id}
				disabled={fixed}
				onChange={(v) => onEdit(at("id"), v)}
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
		<Tier value={member.tier} onEdit={(v) => onEdit(at("tier"), v)} />
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
			<div style={ROW}>
				<strong>{member.name || member.id}</strong>
				<button
					type="button"
					className="mete-button quiet"
					onClick={props.onRemove}
				>
					{nls.localize("mete/team/removeMember", "Remove member")}
				</button>
			</div>
			<Fields member={member} at={at} onEdit={onEdit} fixed={props.fixed} />
			<Reach
				member={member}
				others={others}
				hints={props.hints}
				at={at}
				onEdit={onEdit}
			/>
			{tasks.length === 0 ? (
				<p style={MUTED} role="note">
					{nls.localize(
						"mete/team/idle",
						"No task names this member yet, so it works only when a task list gives it one. Add a task to give it work.",
					)}
				</p>
			) : null}
			{tasks.map((i) => (
				<TaskRow
					key={i}
					team={team}
					index={i}
					onEdit={onEdit}
					onRemove={() => props.onRemoveTask(i)}
				/>
			))}
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
