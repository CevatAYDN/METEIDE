import type { Transcript } from "@mete/contracts";
import {
	type Place,
	placeOfTask,
	type TaskCard,
	type TeamView,
} from "@mete/ui-studio";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import { useId, useState } from "react";
import { roleWords } from "../domain/roster.js";
import { LIST, MUTED } from "./look.js";
import { Icon } from "./roster-look.js";
import { StepList } from "./step-list.js";
import { placeWord } from "./task-words.js";

// The rail's Tasks tab (ADR-119): every task of the run, in the order the team file lists them,
// with where it stands and its member, as the side view's two-line rows with a tile (ADR-109). A
// task that has steps opens them under its row (ADR-125): its own conversation, and a reviewer's
// while the review runs.

type Look = { readonly icon: string; readonly tone?: string };

const LOOKS: Readonly<
	Record<Place["column"] | NonNullable<Place["marker"]>, Look>
> = {
	todo: { icon: "circle-outline" },
	in_progress: { icon: "sync", tone: "accent" },
	done: { icon: "pass", tone: "good" },
	in_review: { icon: "eye", tone: "accent" },
	changes_asked: { icon: "comment", tone: "warn" },
	blocked: { icon: "error", tone: "bad" },
	not_merged: { icon: "git-merge", tone: "bad" },
};

/** What a task's steps need: the run's transcript, the Markdown renderer, and whether the run is running. */
export type RailSteps = {
	readonly transcript?: Transcript | undefined;
	readonly markdown: MarkdownRenderer;
	readonly live: boolean;
};

type Conversation = Transcript["conversations"][number];

const Head = ({
	task,
	member,
}: {
	readonly task: TaskCard;
	readonly member: string;
}) => {
	const place = placeOfTask(task);
	const look = LOOKS[place.marker ?? place.column];
	return (
		<>
			<span
				className={`mete-tile${look.tone ? ` ${look.tone}` : ""}`}
				aria-hidden="true"
			>
				<Icon name={look.icon} />
			</span>
			<span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
				<span className="mete-title" title={task.title}>
					{task.title}
				</span>
				<span className="mete-sub">
					{placeWord(place)} · {member}
				</span>
			</span>
		</>
	);
};

const TaskSteps = ({
	conversations,
	steps,
	thinkingSince,
}: {
	readonly conversations: readonly Conversation[];
	readonly steps: RailSteps;
	readonly thinkingSince?: string | undefined;
}) =>
	conversations.length === 0 ? (
		<StepList
			steps={[]}
			markdown={steps.markdown}
			live={steps.live}
			thinkingSince={thinkingSince}
		/>
	) : (
		conversations.map((c, i) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: a task's conversations never reorder: its own, then a running review.
			<div key={i}>
				{conversations.length > 1 ? (
					<span className="mete-step-caption">{roleWords(c.roleId)}</span>
				) : null}
				<StepList
					steps={c.steps}
					markdown={steps.markdown}
					live={steps.live}
					thinkingSince={
						i === conversations.length - 1 ? thinkingSince : undefined
					}
				/>
			</div>
		))
	);

const Row = ({
	task,
	member,
	conversations,
	steps,
	thinkingSince,
}: {
	readonly task: TaskCard;
	readonly member: string;
	readonly conversations: readonly Conversation[];
	readonly steps: RailSteps;
	readonly thinkingSince?: string | undefined;
}) => {
	const [open, setOpen] = useState(false);
	const id = useId();
	if (conversations.length === 0 && !thinkingSince)
		return (
			<li className="mete-item">
				<Head task={task} member={member} />
			</li>
		);
	return (
		<li>
			<button
				type="button"
				className="mete-item mete-rail-task"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen(!open)}
			>
				<Head task={task} member={member} />
				<Icon name={open ? "chevron-down" : "chevron-right"} />
			</button>
			<div id={id} className="mete-step-detail" hidden={!open}>
				{open ? (
					<TaskSteps
						conversations={conversations}
						steps={steps}
						thinkingSince={thinkingSince}
					/>
				) : null}
			</div>
		</li>
	);
};

// The task whose model call is in flight, when one is.
const thinkingTask = (view: TeamView) =>
	view.thinkingSince ? view.agents.find((a) => a.thinking)?.taskId : undefined;

export const RailTasks = ({
	view,
	names,
	steps,
}: {
	readonly view: TeamView;
	readonly names: Readonly<Record<string, string>>;
	readonly steps: RailSteps;
}) => {
	const thinking = thinkingTask(view);
	return view.tasks.length === 0 ? (
		<p style={{ ...MUTED, margin: 0 }}>
			{nls.localize(
				"mete/board/noTasks",
				"This run has no tasks: a single agent works without a board, and its answer appears here when the run finishes.",
			)}
		</p>
	) : (
		<ul style={{ ...LIST, margin: 0 }}>
			{view.tasks.map((t) => (
				<Row
					key={t.id}
					task={t}
					member={names[t.roleId] ?? roleWords(t.roleId)}
					conversations={
						steps.transcript?.conversations.filter((c) => c.taskId === t.id) ??
						[]
					}
					steps={steps}
					thinkingSince={thinking === t.id ? view.thinkingSince : undefined}
				/>
			))}
		</ul>
	);
};
