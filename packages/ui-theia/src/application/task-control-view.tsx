import type { TaskControlAnswer, TaskPending } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { FormEvent } from "react";
import { Icon } from "./roster-look.js";
import { failureText } from "./status-text.js";
import type { TaskControlState } from "./task-control-session.js";

type Send = (input: TaskControlAnswer) => Promise<void>;
const identity = (r: TaskPending) => ({
	runId: r.runId,
	taskId: r.taskId,
	requestId: r.requestId,
});
const command = (label: string, icon: string, run: () => void) => (
	<button type="button" className="mete-button quiet" onClick={run}>
		<Icon name={icon} />
		{label}
	</button>
);
const reason = (r: TaskPending) => {
	switch (r.kind) {
		case "policy":
			return `${r.ask.action}: ${r.ask.command ?? r.ask.path ?? r.ask.capability} (${r.rule})`;
		case "approval":
			return (
				r.report ?? nls.localize("mete/tasks/review", "Approval requested")
			);
		case "clarification":
			return r.question;
		case "blocked":
			if (r.reason === "verification")
				return nls.localize(
					"mete/tasks/verification",
					"Verification needs attention. Inspect the recorded checks and any interrupted effects before continuing.",
				);
			return r.reason === "setup_interrupted"
				? nls.localize(
						"mete/tasks/setupInterrupted",
						"Setup was interrupted. Verify its effects before retrying.",
					)
				: r.reason;
		case "merge":
			return [r.message, ...(r.paths ?? [])].join("\n");
	}
};
const actions = (r: TaskPending, send: Send) => {
	const id = identity(r);
	if (r.kind === "policy")
		return (
			<>
				{command(
					nls.localize("mete/tasks/once", "Allow once"),
					"check",
					() => void send({ ...id, decision: "allow", scope: "once" }),
				)}
				{command(
					nls.localize("mete/tasks/task", "Allow for this task"),
					"check-all",
					() => void send({ ...id, decision: "allow", scope: "task" }),
				)}
			</>
		);
	if (r.kind !== "approval" && r.kind !== "merge") return null;
	const approve = r.kind === "approval";
	return command(
		approve
			? nls.localize("mete/home/approve", "Approve")
			: nls.localize("mete/tasks/retryMerge", "Retry merge"),
		approve ? "check" : "refresh",
		() => void send({ ...id, decision: approve ? "approve" : "retry" }),
	);
};
const feedbackLabel = (r: TaskPending) =>
	r.kind === "approval"
		? nls.localize("mete/tasks/revise", "Revise")
		: r.kind === "blocked"
			? nls.localize("mete/tasks/continue", "Continue with feedback")
			: nls.localize("mete/tasks/answer", "Send answer");
const feedback = (
	r: TaskPending,
	send: Send,
	event: FormEvent<HTMLFormElement>,
) => {
	event.preventDefault();
	if (r.kind === "policy" || r.kind === "merge") return;
	const text = String(
		new FormData(event.currentTarget).get("feedback") ?? "",
	).trim();
	if (text)
		void send({
			...identity(r),
			decision: r.kind === "approval" ? "revise" : "answer",
			feedback: text,
		});
};
/** One exact pending request; its uncontrolled draft survives failed submissions. */
export const TaskRequest = ({
	request: r,
	disabled,
	busy,
	error,
	onAnswer,
}: {
	readonly request: TaskPending;
	readonly disabled?: boolean;
	readonly busy?: boolean;
	readonly error?: string | undefined;
	readonly onAnswer: Send;
}) => (
	<li className="mete-task-request" aria-busy={busy}>
		<h4>{r.title}</h4>
		<p className="mete-task-reason">{reason(r)}</p>
		{r.worktree ? (
			<p>{nls.localize("mete/tasks/worktree", "Worktree: {0}", r.worktree)}</p>
		) : null}
		{r.branch ? (
			<p>{nls.localize("mete/tasks/branch", "Branch: {0}", r.branch)}</p>
		) : null}
		<form onSubmit={(event) => feedback(r, onAnswer, event)}>
			<fieldset disabled={disabled}>
				<div className="mete-task-actions">{actions(r, onAnswer)}</div>
				{r.kind !== "policy" && r.kind !== "merge" ? (
					<>
						<label>
							{nls.localize("mete/tasks/feedback", "Feedback")}
							<textarea
								className="mete-field"
								name="feedback"
								rows={2}
								required
							/>
						</label>
						<button type="submit" className="mete-button">
							<Icon name="send" />
							{feedbackLabel(r)}
						</button>
					</>
				) : null}
			</fieldset>
		</form>
		{busy ? (
			<p role="status">
				{nls.localize("mete/tasks/sending", "Sending decision...")}
			</p>
		) : null}
		{error ? <p role="alert">{error}</p> : null}
	</li>
);
/** Authoritative task decisions stay visible while the rest of the run continues. */
export const TaskControlView = ({
	state,
	onAnswer,
	onRefresh,
}: {
	readonly state: TaskControlState;
	readonly onAnswer: Send;
	readonly onRefresh: () => void;
}) => {
	if (state.phase === "idle") return null;
	const title = nls.localize("mete/tasks/title", "Task decisions");
	const refresh = nls.localize("mete/tasks/refresh", "Refresh task decisions");
	const message =
		state.phase === "loading"
			? nls.localize("mete/tasks/loading", "Loading task decisions...")
			: state.requests.length === 0 && state.phase === "ready"
				? nls.localize("mete/tasks/empty", "No pending task decisions")
				: undefined;
	return (
		<section className="mete-task-controls" aria-label={title}>
			<header>
				<h3>{title}</h3>
				<button
					type="button"
					className="mete-button quiet icon"
					title={refresh}
					aria-label={refresh}
					disabled={state.phase === "loading"}
					onClick={onRefresh}
				>
					<Icon name="refresh" />
				</button>
			</header>
			{message ? <p role="status">{message}</p> : null}
			{state.failure ? <p role="alert">{failureText(state.failure)}</p> : null}
			<ul>
				{state.requests.map((request) => (
					<TaskRequest
						key={`${request.taskId}:${request.requestId}`}
						request={request}
						disabled={
							state.phase !== "ready" || state.busy.includes(request.requestId)
						}
						busy={state.busy.includes(request.requestId)}
						error={state.errors[request.requestId]}
						onAnswer={onAnswer}
					/>
				))}
			</ul>
		</section>
	);
};
