import type { TeamState } from "../../src/domain/team.js";
import { verifyOf } from "../../src/domain/team-run.js";
import {
	reportSha256,
	withVerification,
} from "../../src/domain/verification.js";

/** Supplies explicit successful evidence in pure fixtures whose scenario has already checked the report. */
export const checkedTeam = (
	team: TeamState,
	task: string,
	report: string,
): TeamState => {
	const entry = team.tasks[task];
	if (!entry) throw new Error("fixture task missing");
	return withVerification(team, task, {
		evaluationId: crypto.randomUUID(),
		attemptId: entry.attempts?.id ?? entry.id,
		attemptNumber:
			entry.attempts?.goesOn ?? (entry.attempts?.finished.length ?? 0) + 1,
		reportSha256: reportSha256(report),
		startedAt: new Date(0).toISOString(),
		gates: verifyOf(team, task).map((gate, index) => ({
			index,
			gate: "run" in gate ? gate.run : gate.capability,
			optional: "optional" in gate && gate.optional === true,
			status: "passed",
			details: "Fixture check completed.",
		})),
	});
};
