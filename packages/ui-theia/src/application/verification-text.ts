import type { VerificationGate } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";

/** Verification labels share one vocabulary across evidence and template authoring. */
export const verificationText = () => ({
	title: nls.localize("mete/verification/title", "Verification evidence"),
	refresh: nls.localize(
		"mete/verification/refresh",
		"Refresh verification evidence",
	),
	loading: nls.localize(
		"mete/verification/loading",
		"Loading verification evidence...",
	),
	failed: nls.localize(
		"mete/verification/readFailed",
		"Verification evidence could not be read. Refresh to try again.",
	),
	stale: nls.localize(
		"mete/verification/stale",
		"Previously read evidence; it may be out of date.",
	),
	empty: nls.localize(
		"mete/verification/empty",
		"No current verification record. This does not certify a pass.",
	),
	noChecks: nls.localize(
		"mete/verification/noChecks",
		"No checks recorded for this evaluation. This does not certify a pass.",
	),
	strict: nls.localize("mete/verification/strict", "Strict verification"),
	legacy: nls.localize(
		"mete/verification/legacy",
		"Legacy verification rules. Complete required-check evidence is unavailable.",
	),
	required: nls.localize("mete/verification/required", "Required"),
	optional: nls.localize("mete/verification/optional", "Optional"),
	current: nls.localize("mete/verification/current", "Current attempt"),
	identity: nls.localize("mete/verification/identity", "Evidence identity"),
	attempt: nls.localize("mete/verification/attemptId", "Attempt ID"),
	evaluation: nls.localize("mete/verification/evaluationId", "Evaluation ID"),
	report: nls.localize("mete/verification/report", "Report SHA-256"),
	started: nls.localize("mete/verification/started", "Started"),
});

/** A gate state is execution evidence, never a task's approval status. */
export const verificationStatus = (gate: VerificationGate): string => {
	if (gate.status === "not_run" && gate.reason === "interrupted")
		return nls.localize("mete/verification/uncertain", "Outcome uncertain");
	return {
		running: nls.localize("mete/verification/running", "Running"),
		passed: nls.localize("mete/verification/passed", "Passed"),
		failed: nls.localize("mete/verification/failed", "Failed"),
		not_run: nls.localize("mete/verification/notRun", "Not run"),
	}[gate.status];
};

/** Exact not-run reasons remain distinct from executed failures. */
export const verificationReason = (
	reason: Extract<VerificationGate, { status: "not_run" }>["reason"],
): string =>
	({
		not_reached: nls.localize("mete/verification/notReached", "Not reached"),
		capability_missing: nls.localize(
			"mete/verification/capabilityMissing",
			"Capability unavailable",
		),
		approval_required: nls.localize(
			"mete/verification/approvalRequired",
			"Awaiting approval",
		),
		denied: nls.localize("mete/verification/denied", "Permission denied"),
		unsupported_expect: nls.localize(
			"mete/verification/unsupportedExpect",
			"Unsupported check condition",
		),
		interrupted: nls.localize(
			"mete/verification/interrupted",
			"Interrupted; effects need inspection",
		),
	})[reason];
