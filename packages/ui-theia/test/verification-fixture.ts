import type { TaskVerificationResult } from "@mete/contracts";

export const VERIFICATION_RUN = "11111111-1111-4111-8111-111111111111";
export const VERIFICATION_ATTEMPT = "33333333-3333-4333-8333-333333333333";

/** Independent durable evidence fixture; duplicate commands are distinct positions. */
export const verificationFixture: TaskVerificationResult = {
	mode: "strict",
	tasks: [
		{
			taskId: "22222222-2222-4222-8222-222222222222",
			templateTaskId: "write",
			title: "Write <report>",
			currentAttemptId: VERIFICATION_ATTEMPT,
			evaluations: [
				{
					evaluationId: "44444444-4444-4444-8444-444444444444",
					attemptId: VERIFICATION_ATTEMPT,
					attemptNumber: 2,
					reportSha256: "a".repeat(64),
					startedAt: "2026-11-08T10:00:00.000Z",
					gates: [
						{
							index: 0,
							gate: "check",
							optional: false,
							status: "passed",
							details: "exit 0",
						},
						{
							index: 1,
							gate: "check",
							optional: true,
							status: "not_run",
							reason: "capability_missing",
							details: "adapter unavailable",
						},
						{
							index: 2,
							gate: "build",
							optional: false,
							status: "failed",
							details: "<script>not executable</script>",
						},
						{
							index: 3,
							gate: "test",
							optional: false,
							status: "running",
							details: "",
						},
					],
				},
			],
		},
	],
};
