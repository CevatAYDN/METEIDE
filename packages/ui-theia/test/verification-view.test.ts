import type {
	VerificationGate,
	VerificationNotRunReasonSchema,
} from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { z } from "zod";
import type { VerificationState } from "../src/application/verification-session.js";
import { VerificationView } from "../src/application/verification-view.js";
import {
	VERIFICATION_ATTEMPT,
	verificationFixture,
} from "./verification-fixture.js";

const html = (state: VerificationState) =>
	renderToStaticMarkup(
		createElement(VerificationView, { state, onRefresh: () => {} }),
	);
const ready: VerificationState = {
	phase: "ready",
	result: verificationFixture,
	failure: undefined,
};

it("renders duplicate gate positions, required/optional, every outcome and escaped details", () => {
	const out = html(ready);
	for (const text of [
		"Strict verification",
		"Current attempt 2",
		"Required",
		"Optional",
		"Running",
		"Passed",
		"Failed",
		"Not run",
		"Capability unavailable",
		"exit 0",
	])
		expect(out).toContain(text);
	expect(out).toContain("Write &lt;report&gt;");
	expect(out).toContain("&lt;script&gt;not executable&lt;/script&gt;");
	expect(out).not.toContain("<script>");
	expect(out.match(/data-gate-index=/g)).toHaveLength(4);
	expect(out).toContain('data-gate-index="0"');
	expect(out).toContain('data-gate-index="1"');
	expect(out.match(/<code>check<\/code>/g)).toHaveLength(2);
	expect(out).toContain(VERIFICATION_ATTEMPT);
	expect(out).toContain("a".repeat(64));
});

it("separates another attempt's pass from an unrecorded current attempt", () => {
	const out = html({
		...ready,
		result: {
			...verificationFixture,
			tasks: verificationFixture.tasks.map((task) => ({
				...task,
				currentAttemptId: "55555555-5555-4555-8555-555555555555",
			})),
		},
	});
	expect(out).toContain("Current attempt");
	expect(out).toContain("Other attempt 2");
	expect(out).toContain(
		"No current verification record. This does not certify a pass.",
	);
	expect(out).not.toContain("Current attempt 2");
});

it("keeps legacy, empty, loading and read failure distinct without certifying any of them", () => {
	const legacy = html({ ...ready, result: { mode: "legacy", tasks: [] } });
	expect(legacy).toContain(
		"Legacy verification rules. Complete required-check evidence is unavailable.",
	);
	expect(legacy).toContain(
		"No current verification record. This does not certify a pass.",
	);
	expect(legacy).not.toContain("required checks were not enforced");
	const loading = html({
		phase: "loading",
		result: undefined,
		failure: undefined,
	});
	expect(loading).toContain("Loading verification evidence...");
	expect(loading).not.toContain("No current verification record");
	const failed = html({
		phase: "failed",
		result: undefined,
		failure: { code: "not_ready", detail: "core" },
	});
	expect(failed).toContain('role="alert"');
	expect(failed).toContain(
		"Verification evidence could not be read. Refresh to try again.",
	);
	expect(failed).not.toContain("No current verification record");
	const stale = html({
		...ready,
		phase: "failed",
		failure: { code: "refused", detail: "read" },
	});
	expect(stale).toContain("Previously read evidence; it may be out of date.");
	expect(stale).toContain("Passed");
});

const reasons: readonly [
	z.infer<typeof VerificationNotRunReasonSchema>,
	string,
][] = [
	["not_reached", "Not reached"],
	["capability_missing", "Capability unavailable"],
	["approval_required", "Awaiting approval"],
	["denied", "Permission denied"],
	["unsupported_expect", "Unsupported check condition"],
	["interrupted", "Interrupted; effects need inspection"],
];
it.each(reasons)(
	"renders the exact not-run reason %s in understandable language",
	(reason, label) => {
		const result = {
			...verificationFixture,
			tasks: verificationFixture.tasks.map((task) => ({
				...task,
				evaluations: task.evaluations.map((evaluation) => ({
					...evaluation,
					gates: [
						{
							index: 0,
							gate: "check",
							optional: false,
							status: "not_run" as const,
							reason,
							details: "",
						},
					],
				})),
			})),
		};
		const out = html({ ...ready, result });
		expect(out).toContain(label);
		if (reason === "interrupted") {
			expect(out).toContain("Outcome uncertain");
			expect(out).not.toContain("<strong>Not run</strong>");
		}
	},
);

const taskSummary = (out: string) => {
	const summary =
		/<details class="mete-verification-task"><summary>([\s\S]*?)<\/summary>/.exec(
			out,
		)?.[1];
	if (!summary) throw new Error("Missing closed task disclosure");
	return summary;
};
const withCurrentGates = (gates: VerificationGate[]) => ({
	...verificationFixture,
	tasks: verificationFixture.tasks.map((task) => ({
		...task,
		evaluations: task.evaluations.flatMap((evaluation) => [
			{ ...evaluation, gates },
			{
				...evaluation,
				evaluationId: "66666666-6666-4666-8666-666666666666",
				attemptId: "55555555-5555-4555-8555-555555555555",
				attemptNumber: 1,
				gates: [
					{
						index: 0,
						gate: "old check",
						optional: false,
						status: "passed" as const,
						details: "old pass",
					},
				],
			},
		]),
	})),
});
const outcomes: readonly [VerificationGate, string][] = [
	[
		{ index: 0, gate: "check", optional: false, status: "failed", details: "" },
		"Failed",
	],
	[
		{
			index: 0,
			gate: "check",
			optional: false,
			status: "running",
			details: "",
		},
		"Running",
	],
	[
		{
			index: 0,
			gate: "check",
			optional: true,
			status: "not_run",
			reason: "capability_missing",
			details: "",
		},
		"Not run",
	],
	[
		{
			index: 0,
			gate: "check",
			optional: false,
			status: "not_run",
			reason: "interrupted",
			details: "",
		},
		"Outcome uncertain",
	],
];
it.each(outcomes)(
	"exposes current %j in the closed summary without a prior pass claim",
	(gate, label) => {
		const summary = taskSummary(
			html({ ...ready, result: withCurrentGates([gate]) }),
		);
		expect(summary).toContain(`Current checks: ${label}`);
		expect(summary).not.toContain("Passed");
		expect(summary).not.toContain("old pass");
	},
);

it("discloses all current outcome kinds instead of hiding a failure behind another check's pass", () => {
	const summary = taskSummary(html(ready));
	for (const label of ["Passed", "Failed", "Not run", "Running"])
		expect(summary).toContain(label);
});

it("distinguishes an existing zero-gate evaluation from no current record, including its closed summary", () => {
	const out = html({ ...ready, result: withCurrentGates([]) });
	const message =
		"No checks recorded for this evaluation. This does not certify a pass.";
	expect(taskSummary(out)).toContain(message);
	expect(out).toContain(message);
	expect(out).not.toContain("No current verification record");
	expect(taskSummary(out)).not.toContain("Passed");
});

it("never puts a previous attempt's outcome in a missing-current summary", () => {
	const result = withCurrentGates([]);
	result.tasks = result.tasks.map((task) => ({
		...task,
		currentAttemptId: "77777777-7777-4777-8777-777777777777",
	}));
	const summary = taskSummary(html({ ...ready, result }));
	expect(summary).toContain(
		"No current verification record. This does not certify a pass.",
	);
	expect(summary).not.toContain("Passed");
});

it.each(["loading", "failed"] as const)(
	"labels retained closed summaries stale during %s reads",
	(phase) => {
		const summary = taskSummary(html({ ...ready, phase }));
		expect(summary).toContain(
			"Previously read evidence; it may be out of date.",
		);
		expect(summary).not.toContain("Current checks");
	},
);
