import { nls } from "@theia/core/lib/common/nls";
import { Chips, type OnEdit, orEmpty, Text, Tick } from "./fields.js";
import { Icon } from "./roster-look.js";
import { type TeamView, toggled } from "./team-draft.js";
import { Work } from "./work-fields.js";

// The tasks that name a member in the team editor (ADR-075): each a raised card with its fields on
// the grid of style/mete-team-form.css, and the defaults a task list gives the member.

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
export const TaskRow = ({
	team,
	index,
	hints,
	onEdit,
	onRemove,
}: TaskProps) => {
	const task = team.tasks[index];
	if (!task) return null;
	const at = (key: string) => ["tasks", index, key] as const;
	const others = team.tasks.map((t) => t.id).filter((id) => id !== task.id);
	return (
		<div className="mete-task">
			<div className="mete-task-head">
				<strong>
					<span className="mete-task-tile">
						<Icon name="tasklist" />
					</span>
					<span className="mete-task-id">{task.id}</span>
				</strong>
				<button
					type="button"
					className="mete-button quiet ghost"
					onClick={onRemove}
				>
					<Icon name="trash" />
					{nls.localize("mete/team/removeTask", "Remove task")}
				</button>
			</div>
			<div className="mete-task-grid">
				<Text
					label={nls.localize("mete/team/taskTitle", "Title")}
					value={task.title}
					wide
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
		</div>
	);
};

/** What a task list gives this member: the defaults of each task it becomes, shown once a task spawns. */
export const SpawnDefaults = (props: {
	readonly team: TeamView;
	readonly id: string;
	readonly hints: readonly string[];
	readonly onEdit: OnEdit;
}) =>
	props.id && props.team.tasks.some((t) => t.spawns) ? (
		<div className="mete-task">
			<div className="mete-task-head">
				<strong>
					{nls.localize(
						"mete/team/spawnDefaults",
						"Tasks a task list gives this member",
					)}
				</strong>
			</div>
			<div className="mete-task-grid">
				<Work
					team={props.team}
					work={props.team.spawn_defaults[props.id] ?? { verify: [] }}
					base={["spawn_defaults", props.id]}
					hints={props.hints}
					onEdit={props.onEdit}
				/>
			</div>
		</div>
	) : null;
