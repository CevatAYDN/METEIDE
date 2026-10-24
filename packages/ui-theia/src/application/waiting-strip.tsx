import type { TaskCard, TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { roleWords } from "../domain/roster.js";
import { LINK, LIST, MUTED, ROW } from "./look.js";
import { openReportLabel, reportPath } from "./results-list.js";
import { Icon, LINE, TONES } from "./roster-look.js";

// The Team panel's Waiting for you strip for the run it shows (ADR-091): a card for each task the
// human was asked to approve, naming its member, or one card for a run that waits for anything else.

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
	borderColor: TONES.warn,
};

// The feedback field is required, so an empty revision is never sent (docs/08).
const Revise = ({ onRevise }: { readonly onRevise: (f: string) => void }) => (
	<details>
		<summary className="mete-button quiet" style={{ display: "inline-flex" }}>
			{nls.localize("mete/home/revise", "Revise…")}
		</summary>
		<form
			style={{ ...ROW, marginTop: "8px" }}
			onSubmit={(e) => {
				e.preventDefault();
				const text = String(new FormData(e.currentTarget).get("feedback"));
				if (text.trim()) onRevise(text.trim());
			}}
		>
			<textarea
				name="feedback"
				required
				rows={2}
				aria-label={nls.localize("mete/run/feedback", "What should change?")}
				placeholder={nls.localize("mete/run/feedback", "What should change?")}
				style={{ flex: "1 1 240px", minWidth: 0 }}
			/>
			<button type="submit" className="mete-button">
				{nls.localize("mete/waiting/send", "Send back")}
			</button>
		</form>
	</details>
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
			<div style={ROW}>
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

// Paused for approval with no task asking the human: a policy ask, a task only the human can
// unblock, or a merge to settle. The events say no more, so the card names nothing else.
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
					{asked.map((t) => (
						<Asked
							key={t.id}
							task={t}
							name={names[t.roleId] ?? roleWords(t.roleId)}
							controls={controls}
						/>
					))}
				</ul>
			) : (
				<RunWaits onResume={controls.onResume} />
			)}
		</section>
	);
};
