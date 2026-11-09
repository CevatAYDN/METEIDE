import type {
	TaskVerificationResult,
	VerificationEvaluation,
	VerificationGate,
} from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { Icon } from "./roster-look.js";
import type { VerificationState } from "./verification-session.js";
import {
	verificationReason,
	verificationStatus,
	verificationText,
} from "./verification-text.js";

type Task = TaskVerificationResult["tasks"][number];
const Gate = ({ gate }: { readonly gate: VerificationGate }) => {
	const text = verificationText();
	return (
		<li data-gate-index={gate.index}>
			<div className="mete-verification-gate">
				<span>
					{nls.localize("mete/verification/gate", "Gate {0}", gate.index + 1)}
				</span>
				<code>{gate.gate}</code>
				<span>{gate.optional ? text.optional : text.required}</span>
				<strong>{verificationStatus(gate)}</strong>
			</div>
			{gate.status === "not_run" ? (
				<p>{verificationReason(gate.reason)}</p>
			) : null}
			{gate.details ? <pre>{gate.details}</pre> : null}
		</li>
	);
};
const EvidenceIdentity = ({
	evaluation: e,
}: {
	readonly evaluation: VerificationEvaluation;
}) => {
	const text = verificationText();
	return (
		<details className="mete-verification-identity">
			<summary>{text.identity}</summary>
			<dl>
				<dt>{text.attempt}</dt>
				<dd>
					<code>{e.attemptId}</code>
				</dd>
				<dt>{text.evaluation}</dt>
				<dd>
					<code>{e.evaluationId}</code>
				</dd>
				<dt>{text.report}</dt>
				<dd>
					<code>{e.reportSha256}</code>
				</dd>
				<dt>{text.started}</dt>
				<dd>
					<time dateTime={e.startedAt}>{e.startedAt}</time>
				</dd>
			</dl>
		</details>
	);
};
const Evaluation = ({
	evaluation: e,
}: {
	readonly evaluation: VerificationEvaluation;
}) => {
	const text = verificationText();
	return (
		<>
			<EvidenceIdentity evaluation={e} />
			{e.gates.length === 0 ? (
				<p>{text.noChecks}</p>
			) : (
				<ol className="mete-verification-gates">
					{e.gates.map((gate) => (
						<Gate key={`${e.evaluationId}:${gate.index}`} gate={gate} />
					))}
				</ol>
			)}
		</>
	);
};
const CurrentAttempt = ({ task }: { readonly task: Task }) => {
	const text = verificationText();
	const current = task.evaluations.find(
		(e) => e.attemptId === task.currentAttemptId,
	);
	return (
		<>
			<h4>
				{current
					? nls.localize(
							"mete/verification/currentNumber",
							"Current attempt {0}",
							current.attemptNumber,
						)
					: text.current}
			</h4>
			<code>{task.currentAttemptId}</code>
			{current ? <Evaluation evaluation={current} /> : <p>{text.empty}</p>}
		</>
	);
};
const currentSummary = (task: Task): string => {
	const text = verificationText();
	const current = task.evaluations.find(
		(e) => e.attemptId === task.currentAttemptId,
	);
	if (!current) return text.empty;
	if (current.gates.length === 0) return text.noChecks;
	const outcomes = [...new Set(current.gates.map(verificationStatus))];
	return nls.localize(
		"mete/verification/currentChecks",
		"Current checks: {0}",
		outcomes.join(", "),
	);
};
const TaskEvidence = ({
	task,
	fresh,
}: {
	readonly task: Task;
	readonly fresh: boolean;
}) => (
	<details className="mete-verification-task">
		<summary>
			{task.title} <code>{task.templateTaskId}</code>
			<span className="mete-verification-summary">
				{fresh ? currentSummary(task) : verificationText().stale}
			</span>
		</summary>
		<CurrentAttempt task={task} />
		{task.evaluations
			.filter((e) => e.attemptId !== task.currentAttemptId)
			.map((e) => (
				<details key={e.evaluationId} className="mete-verification-other">
					<summary>
						{nls.localize(
							"mete/verification/otherNumber",
							"Other attempt {0}",
							e.attemptNumber,
						)}
					</summary>
					<Evaluation evaluation={e} />
				</details>
			))}
	</details>
);

const EvidenceHeader = ({
	loading,
	onRefresh,
}: {
	readonly loading: boolean;
	readonly onRefresh: () => void;
}) => {
	const text = verificationText();
	return (
		<header>
			<h3>{text.title}</h3>
			<button
				type="button"
				className="mete-button quiet icon"
				title={text.refresh}
				aria-label={text.refresh}
				disabled={loading}
				onClick={onRefresh}
			>
				<Icon name="refresh" />
			</button>
		</header>
	);
};
const ReadState = ({ state }: { readonly state: VerificationState }) => {
	const text = verificationText();
	return (
		<>
			{state.phase === "loading" ? <p role="status">{text.loading}</p> : null}
			{state.phase === "failed" ? <p role="alert">{text.failed}</p> : null}
			{state.result && state.phase !== "ready" ? (
				<p role="status">{text.stale}</p>
			) : null}
		</>
	);
};
const Recorded = ({
	result,
	fresh,
}: {
	readonly result: TaskVerificationResult | undefined;
	readonly fresh: boolean;
}) => {
	if (!result) return null;
	const text = verificationText();
	return (
		<>
			<p>{result.mode === "legacy" ? text.legacy : text.strict}</p>
			{result.tasks.length === 0 ? (
				<p>{text.empty}</p>
			) : (
				result.tasks.map((task) => (
					<TaskEvidence key={task.taskId} task={task} fresh={fresh} />
				))
			)}
		</>
	);
};

/** Compact authoritative evidence; a read error or absent record never implies a pass. */
export const VerificationView = ({
	state,
	onRefresh,
}: {
	readonly state: VerificationState;
	readonly onRefresh: () => void;
}) => {
	if (state.phase === "idle") return null;
	const text = verificationText();
	return (
		<section
			className="mete-verification"
			aria-label={text.title}
			aria-busy={state.phase === "loading"}
		>
			<EvidenceHeader
				loading={state.phase === "loading"}
				onRefresh={onRefresh}
			/>
			<ReadState state={state} />
			<Recorded result={state.result} fresh={state.phase === "ready"} />
		</section>
	);
};
