import type { AllowScope } from "@mete/contracts";
import type { TaskCard, TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { useId, useState } from "react";
import { questionsOf, withPick } from "../domain/questions.js";
import { roleWords } from "../domain/roster.js";
import { NotMerged } from "./merge-waits.js";
import { QuestionList } from "./question-list.js";
import { openReportLabel, reportPath } from "./results-list.js";
import { Icon } from "./roster-look.js";
import { askKey, RunWaits } from "./run-waits.js";
import { Card } from "./wait-card.js";

// The Team panel's Waiting for you strip for the run it shows (ADR-091): a card for each task that
// waits for the human — one asking to be approved, or one blocked until the human answers (docs/07)
// — naming its member, or one whose merge did not land (ADR-156), or one card for a run that waits
// for anything else. The cards wear the redesign's look, laid out by style/mete-run.css (ADR-119).

/** What the strip's buttons do: ADR-048's commands, for the run the panel shows. */
export type WaitingControls = {
	readonly onApprove: () => void;
	readonly onRevise: (feedback: string) => void;
	readonly onResume: () => void;
	readonly onOpen: (path: string) => void;
	/** Lists the files of a submitted task's worktree to open one: those it changed, when known (ADR-132, ADR-141). */
	readonly onShowFiles: (worktree: string, files?: readonly string[]) => void;
	readonly onAllow?:
		| ((scope: AllowScope) => Promise<string | undefined>)
		| undefined;
};

/** An answer its card holds, so a picked option fills it and opens it (ADR-148). */
type Draft = {
	readonly text: string;
	readonly open: boolean;
	readonly onText: (text: string) => void;
	readonly onOpen: (open: boolean) => void;
};

// The answer field is required, so an empty answer is never sent (docs/08). One form for both
// answers — the words that should change, and the instruction that lifts a block.
const Feedback = ({
	icon,
	open,
	placeholder,
	send,
	onSend,
	draft,
}: {
	readonly icon: string;
	readonly open: string;
	readonly placeholder: string;
	readonly send: string;
	readonly onSend: (feedback: string) => void;
	readonly draft?: Draft | undefined;
}) => (
	<details
		className="mete-wait-feedback"
		open={draft?.open}
		onToggle={(e) => draft?.onOpen(e.currentTarget.open)}
	>
		<summary className="mete-button quiet">
			<Icon name={icon} />
			{open}
			<Icon name="chevron-down" />
		</summary>
		<form
			onSubmit={(e) => {
				e.preventDefault();
				const text = String(new FormData(e.currentTarget).get("feedback"));
				if (text.trim()) onSend(text.trim());
			}}
		>
			<textarea
				name="feedback"
				required
				rows={2}
				value={draft?.text}
				onChange={draft ? (e) => draft.onText(e.target.value) : undefined}
				aria-label={placeholder}
				placeholder={placeholder}
			/>
			<button type="submit" className="mete-button">
				{send}
			</button>
		</form>
	</details>
);

// Sends a submission back with the words that should change (docs/08, revision limit).
const Revise = ({ onRevise }: { readonly onRevise: (f: string) => void }) => (
	<Feedback
		icon="reply"
		open={nls.localize("mete/home/revise", "Revise…")}
		placeholder={nls.localize("mete/run/feedback", "What should change?")}
		send={nls.localize("mete/waiting/send", "Send back")}
		onSend={onRevise}
	/>
);

// A blocked task goes on with the human's instruction as its next attempt (docs/07, Task state
// machine; docs/08).
const Instruct = ({ onRevise }: { readonly onRevise: (f: string) => void }) => (
	<Feedback
		icon="comment"
		open={nls.localize("mete/waiting/instruct", "Give an instruction…")}
		placeholder={nls.localize("mete/waiting/instruction", "What should it do?")}
		send={nls.localize("mete/waiting/sendInstruction", "Send the instruction")}
		onSend={onRevise}
	/>
);

// The task's report as a file chip that opens it (ADR-085); none before the task wrote one.
const ReportChip = ({
	task,
	onOpen,
}: {
	readonly task: TaskCard;
	readonly onOpen: (path: string) => void;
}) => {
	const path = reportPath(task);
	return path ? (
		<button
			type="button"
			className="mete-file-chip"
			title={path}
			aria-label={openReportLabel(task)}
			onClick={() => onOpen(path)}
		>
			<Icon name="file" />
			<span className="mete-mono">{path.slice(path.lastIndexOf("/") + 1)}</span>
			<Icon name="link-external" />
		</button>
	) : null;
};

// The files the task wrote, when it has a worktree, to read before approving (ADR-132).
const ShowFiles = ({
	worktree,
	files,
	onShow,
}: {
	readonly worktree: string;
	readonly files: readonly string[] | undefined;
	readonly onShow: WaitingControls["onShowFiles"];
}) => (
	<button
		type="button"
		className="mete-button quiet"
		onClick={() => onShow(worktree, files)}
	>
		<Icon name="files" />
		{nls.localize("mete/waiting/showFiles", "Show files")}
	</button>
);

const Asked = ({
	task,
	name,
	controls,
}: {
	readonly task: TaskCard;
	readonly name: string;
	readonly controls: WaitingControls;
}) => (
	<Card
		tone="warn"
		icon="eye"
		title={nls.localize(
			"mete/waiting/asks",
			"{0} asks you to approve “{1}”",
			name,
			task.title,
		)}
		kind={{ word: nls.localize("mete/waiting/review", "Review") }}
	>
		<ReportChip task={task} onOpen={controls.onOpen} />
		{task.worktree ? (
			<ShowFiles
				worktree={task.worktree}
				files={task.files}
				onShow={controls.onShowFiles}
			/>
		) : null}
		<div className="mete-wait-actions">
			<button
				type="button"
				className="mete-button"
				onClick={controls.onApprove}
			>
				<Icon name="check" />
				{nls.localize("mete/home/approve", "Approve")}
			</button>
			<Revise onRevise={controls.onRevise} />
		</div>
	</Card>
);

// A blocked task (docs/07, Task state machine): a guardrail's retries ran out or a capability is
// missing, and the run paused for the human. It goes on as it is, or with the human's instruction.
const Blocked = ({
	task,
	name,
	controls,
}: {
	readonly task: TaskCard;
	readonly name: string;
	readonly controls: WaitingControls;
}) => (
	<Card
		tone="bad"
		icon="error"
		title={nls.localize(
			"mete/waiting/blocked",
			"{0} is blocked on “{1}”",
			name,
			task.title,
		)}
		kind={{
			icon: "circle-slash",
			word: nls.localize("mete/board/blocked", "Blocked"),
		}}
	>
		<p className="mete-wait-note">
			{nls.localize(
				"mete/waiting/blockedHint",
				"It goes on when you answer: send an instruction, or let it go on as it is.",
			)}
		</p>
		<div className="mete-wait-actions">
			<button
				type="button"
				className="mete-button quiet"
				onClick={controls.onApprove}
			>
				<Icon name="debug-continue" />
				{nls.localize("mete/waiting/goOn", "Go on")}
			</button>
			<Instruct onRevise={controls.onRevise} />
		</div>
	</Card>
);

// The questions a task asks the human before its work (docs/08, step 1; ADR-142): it goes on with
// the answer, or without one. A picked option fills in the answer and opens it (ADR-148).
const Asking = ({
	task,
	name,
	controls,
}: {
	readonly task: TaskCard;
	readonly name: string;
	readonly controls: WaitingControls;
}) => {
	const [text, onText] = useState("");
	const [open, onOpen] = useState(false);
	const pick = (question: string, option: string) => {
		onText((t) => withPick(t, question, option));
		onOpen(true);
	};
	return (
		<Card
			tone="warn"
			icon="question"
			title={nls.localize(
				"mete/waiting/asksFirst",
				"{0} asks you before “{1}”",
				name,
				task.title,
			)}
			kind={{ word: nls.localize("mete/waiting/question", "Question") }}
		>
			<QuestionList
				questions={questionsOf(task.question?.text ?? "")}
				onPick={pick}
			/>
			<div className="mete-wait-actions">
				<Feedback
					icon="comment"
					open={nls.localize("mete/waiting/answer", "Answer…")}
					placeholder={nls.localize("mete/waiting/yourAnswer", "Your answer")}
					send={nls.localize("mete/waiting/sendAnswer", "Send the answer")}
					onSend={controls.onRevise}
					draft={{ text, open, onText, onOpen }}
				/>
				<button
					type="button"
					className="mete-button quiet"
					onClick={controls.onApprove}
				>
					<Icon name="debug-continue" />
					{nls.localize("mete/waiting/noAnswers", "Go on without answers")}
				</button>
			</div>
		</Card>
	);
};

const TaskCardItem = ({
	task,
	name,
	controls,
}: {
	readonly task: TaskCard;
	readonly name: string;
	readonly controls: WaitingControls;
}) =>
	task.merge ? (
		<NotMerged task={task} onApprove={controls.onApprove} />
	) : task.status === "blocked" && task.question?.to === "human" ? (
		<Asking task={task} name={name} controls={controls} />
	) : task.status === "blocked" ? (
		<Blocked task={task} name={name} controls={controls} />
	) : (
		<Asked task={task} name={name} controls={controls} />
	);

/** The strip, while the run is paused for approval; nothing otherwise. */
export const WaitingStrip = ({
	view,
	names,
	controls,
}: {
	readonly view: TeamView;
	readonly names: Readonly<Record<string, string>>;
	readonly controls: WaitingControls;
}) => {
	const title = useId();
	if (view.signals.pausedFor !== "approval") return null;
	const waiting = view.tasks.filter((t) => t.waitsForHuman);
	return (
		<section className="mete-wait" aria-labelledby={title}>
			<h3 className="mete-wait-title" id={title}>
				<Icon name="bell" />
				{nls.localize("mete/home/waiting", "Waiting for you")}
				{waiting.length > 0 ? (
					<span className="mete-count">{waiting.length}</span>
				) : null}
			</h3>
			<ul className="mete-wait-cards">
				{waiting.length > 0 ? (
					waiting.map((t) => (
						<TaskCardItem
							key={t.id}
							task={t}
							name={names[t.roleId] ?? roleWords(t.roleId)}
							controls={controls}
						/>
					))
				) : (
					<RunWaits
						key={askKey(view.signals.asked)}
						asked={view.signals.asked}
						onResume={controls.onResume}
						onAllow={controls.onAllow}
					/>
				)}
			</ul>
		</section>
	);
};
