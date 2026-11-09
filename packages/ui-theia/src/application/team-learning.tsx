import { nls } from "@theia/core/lib/common/nls";
import type { OnEdit } from "./fields.js";
import { Icon } from "./roster-look.js";
import { uniqueKeys } from "./row-keys.js";
import type { TeamView, WorkView } from "./team-draft.js";

type Props = {
	readonly team: TeamView;
	readonly busy: boolean;
	readonly onEdit: OnEdit;
	readonly onCommand: (id: string) => void;
};

const LessonChoice = (props: {
	readonly label: string;
	readonly work: WorkView;
	readonly base: readonly (string | number)[];
	readonly disabled: boolean;
	readonly onEdit: OnEdit;
}) => (
	<label className="mete-tick">
		<input
			type="checkbox"
			checked={props.work.memory?.write_lessons === true}
			disabled={props.disabled}
			onChange={(event) => {
				if (props.disabled) return;
				props.onEdit(
					[...props.base, "memory"],
					event.target.checked ? { write_lessons: true } : undefined,
				);
			}}
		/>
		{props.label}
	</label>
);

const taskChoices = (props: Props) => {
	const keys = uniqueKeys(props.team.tasks.map((task) => task.id));
	return props.team.tasks.map((task, index) => {
		const member = props.team.roles.find((role) => role.id === task.role);
		return (
			<LessonChoice
				key={keys[index]}
				label={nls.localize(
					"mete/team/learningTask",
					"{0} ({1}): write a lesson after approval",
					task.title || task.id,
					member?.name || task.role,
				)}
				work={task}
				base={["tasks", index]}
				disabled={props.busy || !member}
				onEdit={props.onEdit}
			/>
		);
	});
};

const generatedChoices = (props: Props) => {
	if (!props.team.tasks.some((task) => task.spawns)) return null;
	return Object.entries(props.team.spawn_defaults).flatMap(([role, work]) => {
		const member = props.team.roles.find((candidate) => candidate.id === role);
		if (!member) return [];
		return [
			<LessonChoice
				key={role}
				label={nls.localize(
					"mete/team/learningGenerated",
					"Generated-task defaults for {0}: write a lesson after approval",
					member.name || role,
				)}
				work={work}
				base={["spawn_defaults", role]}
				disabled={props.busy}
				onEdit={props.onEdit}
			/>,
		];
	});
};

/** Task-scoped lesson settings, not training or evidence that a lesson was written (ADR-145/192). */
export const TeamLearning = (props: Props) => (
	<details className="mete-team-learning">
		<summary>{nls.localize("mete/team/learning", "Learning")}</summary>
		<p>
			{nls.localize(
				"mete/team/learningCost",
				"One extra model request per approved task with lesson writing enabled.",
			)}
		</p>
		<div className="mete-team-learning-rows">
			{taskChoices(props)}
			{generatedChoices(props)}
		</div>
		{props.team.tasks.length === 0 ? (
			<p>{nls.localize("mete/team/learningEmpty", "No tasks configured.")}</p>
		) : null}
		<button
			type="button"
			className="mete-button quiet"
			disabled={props.busy}
			onClick={() => {
				if (!props.busy) props.onCommand("mete.memory.open");
			}}
		>
			<Icon name="history" />
			{nls.localize("mete/memory/title", "Memory")}
		</button>
	</details>
);
