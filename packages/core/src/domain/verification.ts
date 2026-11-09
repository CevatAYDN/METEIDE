import { createHash } from "node:crypto";
import type {
	ChatMessage,
	VerificationEvaluation,
	VerificationGate,
} from "@mete/contracts";
import { checkReport } from "./guardrail.js";
import type { TeamState } from "./team-schema.js";

const taskOf = (team: TeamState, task: string) =>
	team.template.tasks.find((definition) => definition.id === task);

/** SHA-256 of the masked reply, not a model's assertion about its checks. */
export const reportSha256 = (report: string) =>
	createHash("sha256").update(report).digest("hex");

/** Explicit optionality permits only known nonexecution, never failure or uncertainty. */
export const gateEligible = (gate: VerificationGate) =>
	gate.status === "passed" ||
	(gate.optional &&
		gate.status === "not_run" &&
		["capability_missing", "denied", "unsupported_expect"].includes(
			gate.reason,
		));

type Evidence = {
	id: string;
	number: number;
	report?: string | undefined;
	messages: readonly ChatMessage[];
	verification?: VerificationEvaluation | undefined;
};

/** The selected or still-live attempt number, including a last attempt already recorded before a crash. */
export const verificationAttemptNumber = (team: TeamState, task: string) => {
	const entry = team.tasks[task];
	const attempts = entry?.attempts;
	if (attempts?.goesOn) return attempts.goesOn;
	const id = attempts?.id ?? entry?.id;
	const recorded =
		attempts?.finished.findIndex((record) => record.id === id) ?? -1;
	return recorded >= 0 ? recorded + 1 : (attempts?.finished.length ?? 0) + 1;
};

const matchingReport = (team: TeamState, task: string, record: Evidence) => {
	const evaluation = record.verification;
	if (!evaluation || record.report === undefined) return false;
	if (reportSha256(record.report) === evaluation.reportSha256) return true;
	const reply = record.messages.findLast(
		(m) => m.role === "assistant",
	)?.content;
	if (
		typeof reply !== "string" ||
		reportSha256(reply) !== evaluation.reportSha256
	)
		return false;
	const definition = taskOf(team, task);
	const schema =
		definition?.guardrail?.schema ??
		(definition?.spawns && definition.expected_output === "artifact:task-list@1"
			? "task-list@1"
			: undefined);
	const checked = checkReport(schema, reply);
	return checked.ok && checked.report === record.report;
};

const optionalAt = (team: TeamState, task: string, index: number) => {
	const gate = taskOf(team, task)?.verify?.[index];
	return !!gate && "optional" in gate && gate.optional === true;
};

/** A candidate must carry its own matching evidence for every configured gate. */
export const eligibleEvidence = (
	team: TeamState,
	task: string,
	record: Evidence,
) => {
	if (team.verificationVersion !== 1) return record.report !== undefined;
	const evaluation = record.verification;
	const gates = taskOf(team, task)?.verify ?? [];
	if (gates.length === 0) return record.report !== undefined;
	return (
		!!evaluation &&
		evaluation.attemptId === record.id &&
		evaluation.attemptNumber === record.number &&
		matchingReport(team, task, record) &&
		evaluation.gates.length === gates.length &&
		evaluation.gates.every(
			(row, index) =>
				row.index === index &&
				row.optional === optionalAt(team, task, index) &&
				gateEligible(row),
		)
	);
};

/** Eligibility of the current attempt; finished evidence cannot certify a newer reply. */
export const eligibleVerification = (
	team: TeamState,
	task: string,
	report: string,
) => {
	const entry = team.tasks[task];
	return (
		!!entry &&
		eligibleEvidence(team, task, {
			id: entry.attempts?.id ?? entry.id,
			report,
			messages: entry.messages,
			number: verificationAttemptNumber(team, task),
			verification: entry.verification,
		})
	);
};

/** Replaces only one task's current evaluation, preserving peer and attempt state. */
export const withVerification = (
	team: TeamState,
	task: string,
	verification: VerificationEvaluation | undefined,
): TeamState => {
	const entry = team.tasks[task];
	return entry
		? { ...team, tasks: { ...team.tasks, [task]: { ...entry, verification } } }
		: team;
};
