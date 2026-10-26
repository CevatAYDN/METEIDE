import type { TaskCard, TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { useId } from "react";
import { roleWords } from "../domain/roster.js";
import { ROW } from "./look.js";
import { openReportLabel, reportPath } from "./results-list.js";
import { Icon } from "./roster-look.js";

// The Team panel's Waiting for you strip for the run it shows (ADR-091): a card for each task that
// waits for the human — one asking to be approved, or one blocked until the human answers (docs/07)
// — naming its member, or one card for a run that waits for anything else. The cards wear the
// redesign's look, laid out by style/mete-run.css (ADR-119).

/** What the strip's buttons do: ADR-048's commands, for the run the panel shows. */
export type WaitingControls = {
	readonly onApprove: () => void;
	readonly onRevise: (feedback: string) => void;
	readonly onResume: () => void;
	readonly onOpen: (path: string) => void;
};

// The answer field is required, so an empty answer is never sent (docs/08). One form for both
// answers — the words that should change, and the instruction that lifts a block.
const Feedback = ({
	open,
	placeholder,
	send,
	onSend,
}: {
	readonly open: string;
	readonly placeholder: string;
	readonly send: string;
	readonly onSend: (feedback: string) => void;
}) => (
	<details>
		<summary className="mete-button quiet" style={{ display: "inline-flex" }}>
			{open}
		</summary>
		<form
			style={{ ...ROW, marginTop: "8px" }}
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
				aria-label={placeholder}
				placeholder={placeholder}
				style={{
					flex: "1 1 320px",
					minWidth: 0,
					font: "inherit",
					padding: "6px 8px",
				}}
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
		open={nls.localize("mete/waiting/instruct", "Give an instruction…")}
		placeholder={nls.localize("mete/waiting/instruction", "What should it do?")}
		send={nls.localize("mete/waiting/sendInstruction", "Send the instruction")}
		onSend={onRevise}
	/>
);

// A card's head: a tile in the wait's tone, the sentence that names the member, and the kind of
// wait when the events tell it.
const Head = ({
	tone,
	icon,
	title,
	kind,
}: {
	readonly tone: "warn" | "bad";
	readonly icon: string;
	readonly title: string;
	readonly kind?: string;
}) => (
	<div className="mete-wait-head">
		<span className={`mete-tile ${tone}`} aria-hidden="true">
			<Icon name={icon} />
		</span>
		<span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
			<strong>{title}</strong>
			{kind ? <span className="mete-sub">{kind}</span> : null}
		</span>
	</div>
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

const Asked = ({
	task,
	name,
	controls,
}: {
	readonly task: TaskCard;
	readonly name: string;
	readonly controls: WaitingControls;
}) => (
	<li className="mete-wait-card">
		<Head
			tone="warn"
			icon="eye"
			title={nls.localize(
				"mete/waiting/asks",
				"{0} asks you to approve “{1}”",
				name,
				task.title,
			)}
			kind={nls.localize("mete/waiting/review", "Review")}
		/>
		<ReportChip task={task} onOpen={controls.onOpen} />
		<div style={{ ...ROW, alignItems: "flex-start" }}>
			<button
				type="button"
				className="mete-button"
				onClick={controls.onApprove}
			>
				{nls.localize("mete/home/approve", "Approve")}
			</button>
			<Revise onRevise={controls.onRevise} />
		</div>
	</li>
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
	<li className="mete-wait-card">
		<Head
			tone="bad"
			icon="error"
			title={nls.localize(
				"mete/waiting/blocked",
				"{0} is blocked on “{1}”",
				name,
				task.title,
			)}
			kind={nls.localize("mete/board/blocked", "Blocked")}
		/>
		<span className="mete-note">
			{nls.localize(
				"mete/waiting/blockedHint",
				"It goes on when you answer: send an instruction, or let it go on as it is.",
			)}
		</span>
		<div style={{ ...ROW, alignItems: "flex-start" }}>
			<button
				type="button"
				className="mete-button"
				onClick={controls.onApprove}
			>
				{nls.localize("mete/waiting/goOn", "Go on")}
			</button>
			<Instruct onRevise={controls.onRevise} />
		</div>
	</li>
);

// Paused for approval with no task asking the human: a policy ask, or a merge to settle. The
// events say no more, so the card names nothing else.
const RunWaits = ({ onResume }: { readonly onResume: () => void }) => (
	<li className="mete-wait-card">
		<Head
			tone="warn"
			icon="debug-pause"
			title={nls.localize("mete/waiting/run", "The run waits for you.")}
		/>
		<span className="mete-note">
			{nls.localize(
				"mete/home/resumeHint",
				"Resume repeats the tool call the policy asked about, so the run stops again unless .mete/policy.yaml allows it.",
			)}
		</span>
		<div style={ROW}>
			<button type="button" className="mete-button" onClick={onResume}>
				{nls.localize("mete/home/resume", "Resume")}
			</button>
		</div>
	</li>
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
	const asked = view.tasks.filter((t) => t.waitsForHuman);
	return (
		<section className="mete-wait" aria-labelledby={title}>
			<h3 className="mete-wait-title" id={title}>
				<Icon name="bell" />
				{nls.localize("mete/home/waiting", "Waiting for you")}
				{asked.length > 0 ? (
					<span className="mete-count">{asked.length}</span>
				) : null}
			</h3>
			<ul className="mete-wait-cards">
				{asked.length > 0 ? (
					asked.map((t) =>
						t.status === "blocked" ? (
							<Blocked
								key={t.id}
								task={t}
								name={names[t.roleId] ?? roleWords(t.roleId)}
								controls={controls}
							/>
						) : (
							<Asked
								key={t.id}
								task={t}
								name={names[t.roleId] ?? roleWords(t.roleId)}
								controls={controls}
							/>
						),
					)
				) : (
					<RunWaits onResume={controls.onResume} />
				)}
			</ul>
		</section>
	);
};
