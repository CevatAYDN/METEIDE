import type { TaskCard, TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { roleWords } from "../domain/roster.js";
import { LINK, LIST, MUTED, ROW } from "./look.js";
import { openReportLabel, reportPath } from "./results-list.js";
import { Icon, LINE } from "./roster-look.js";
import { TONES } from "./tone.js";

// The Team panel's Waiting for you strip for the run it shows (ADR-091): a card for each task that
// waits for the human — one asking to be approved, or one blocked until the human answers (docs/07)
// — naming its member, or one card for a run that waits for anything else.

/** What the strip's buttons do: ADR-048's commands, for the run the panel shows. */
export type WaitingControls = {
	readonly onApprove: () => void;
	readonly onRevise: (feedback: string) => void;
	readonly onResume: () => void;
	readonly onOpen: (path: string) => void;
};

const STRIP: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "10px",
	maxWidth: "960px",
	// The width the Team view's rows take, its padding and border inside it.
	boxSizing: "border-box",
	borderColor: TONES.warn,
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

const Asked = ({
	task,
	name,
	controls,
}: {
	readonly task: TaskCard;
	readonly name: string;
	readonly controls: WaitingControls;
}) => {
	const path = reportPath(task);
	return (
		<li style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
			<div style={LINE}>
				<Icon name="bell" />
				<strong>
					{nls.localize(
						"mete/waiting/asks",
						"{0} asks you to approve “{1}”",
						name,
						task.title,
					)}
				</strong>
				{path ? (
					<button
						type="button"
						style={LINK}
						aria-label={openReportLabel(task)}
						onClick={() => controls.onOpen(path)}
					>
						{path.slice(path.lastIndexOf("/") + 1)}
					</button>
				) : null}
			</div>
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
};

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
	<li style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
		<div style={LINE}>
			<Icon name="alert" />
			<strong>
				{nls.localize(
					"mete/waiting/blocked",
					"{0} is blocked on “{1}”",
					name,
					task.title,
				)}
			</strong>
		</div>
		<span style={MUTED}>
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
	<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
		<div style={ROW}>
			<span>{nls.localize("mete/waiting/run", "The run waits for you.")}</span>
			<button type="button" className="mete-button" onClick={onResume}>
				{nls.localize("mete/home/resume", "Resume")}
			</button>
		</div>
		<span style={MUTED}>
			{nls.localize(
				"mete/home/resumeHint",
				"Resume repeats the tool call the policy asked about, so the run stops again unless .mete/policy.yaml allows it.",
			)}
		</span>
	</div>
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
	if (view.signals.pausedFor !== "approval") return null;
	const asked = view.tasks.filter((t) => t.waitsForHuman);
	return (
		<section
			className="mete-card"
			aria-label={nls.localize("mete/home/waiting", "Waiting for you")}
			style={STRIP}
		>
			{asked.length > 0 ? (
				<ul style={LIST}>
					{asked.map((t) =>
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
					)}
				</ul>
			) : (
				<RunWaits onResume={controls.onResume} />
			)}
		</section>
	);
};
