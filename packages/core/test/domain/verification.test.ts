import { randomUUID } from "node:crypto";
import { parseTemplate, type VerificationEvaluation } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { finishAttempt } from "../../src/domain/attempts.js";
import {
	applyTask,
	decide,
	TeamStateSchema,
	teamOf,
} from "../../src/domain/team.js";
import {
	eligibleVerification,
	reportSha256,
	withVerification,
} from "../../src/domain/verification.js";

const fresh = (optional = false) => {
	const parsed = parseTemplate({
		apiVersion: "mete/v2",
		kind: "TeamTemplate",
		metadata: { id: "verify", name: "Verify", version: "1.0.0" },
		pattern: "single",
		roles: [
			{
				id: "dev",
				name: "Dev",
				goal: "Build",
				tier: "coder",
				capabilities: [],
			},
		],
		tasks: [
			{
				id: "build",
				role: "dev",
				title: "Build",
				verify: [{ run: "check", optional }],
			},
		],
	});
	if (!parsed.ok) throw new Error("invalid fixture");
	return applyTask(teamOf(parsed.value), "build", {
		type: "START",
		agentId: randomUUID(),
	}).team;
};
const evidence = (team: ReturnType<typeof fresh>): VerificationEvaluation => ({
	evaluationId: randomUUID(),
	attemptId: team.tasks.build?.id ?? "",
	attemptNumber: 1,
	startedAt: "2026-11-08T00:00:00.000Z",
	reportSha256: reportSha256("report"),
	gates: [
		{ index: 0, gate: "check", optional: false, status: "passed", details: "" },
	],
});

describe("strict verification snapshot and eligibility", () => {
	it("marks only new teams, preserving an absent marker in old snapshots", () => {
		const team = fresh();
		expect(team.verificationVersion).toBe(1);
		const { verificationVersion: _version, ...legacy } = team;
		expect(TeamStateSchema.parse(legacy).verificationVersion).toBeUndefined();
		expect(
			TeamStateSchema.safeParse(
				withVerification(legacy, "build", evidence(team)),
			).success,
		).toBe(false);
		const finished = finishAttempt(
			withVerification(team, "build", evidence(team)),
			"build",
			{ report: "report", messages: [] },
			randomUUID(),
		);
		const { verificationVersion: _finishedVersion, ...unmarked } = finished;
		expect(unmarked.tasks.build?.verification).toBeUndefined();
		expect(TeamStateSchema.safeParse(unmarked).success).toBe(false);
	});
	it("requires the exact report, attempt and complete ordered evidence", () => {
		const team = fresh();
		const checked = withVerification(team, "build", evidence(team));
		expect(eligibleVerification(checked, "build", "report")).toBe(true);
		expect(eligibleVerification(team, "build", "report")).toBe(false);
		expect(eligibleVerification(checked, "build", "changed")).toBe(false);
		expect(
			eligibleVerification(
				withVerification(team, "build", {
					...evidence(team),
					attemptId: randomUUID(),
				}),
				"build",
				"report",
			),
		).toBe(false);
		expect(
			eligibleVerification(
				withVerification(team, "build", {
					...evidence(team),
					attemptNumber: 2,
				}),
				"build",
				"report",
			),
		).toBe(false);
	});
	it("permits only explicitly optional absence, denial and unsupported expect", () => {
		const team = fresh();
		for (const reason of [
			"capability_missing",
			"denied",
			"unsupported_expect",
			"interrupted",
			"approval_required",
			"not_reached",
		] as const) {
			const checked = withVerification(team, "build", {
				...evidence(team),
				gates: [
					{
						index: 0,
						gate: "check",
						optional: true,
						status: "not_run",
						reason,
						details: "",
					},
				],
			});
			// Optionality must match the template; changing just the evidence cannot authorize a skip.
			expect(eligibleVerification(checked, "build", "report")).toBe(false);
			const optional = fresh(true);
			const gap = withVerification(optional, "build", {
				...evidence(optional),
				gates: [
					{
						index: 0,
						gate: "check",
						optional: true,
						status: "not_run",
						reason,
						details: "",
					},
				],
			});
			expect(eligibleVerification(gap, "build", "report")).toBe(
				["capability_missing", "denied", "unsupported_expect"].includes(reason),
			);
		}
	});
	it("keeps eligible revision-limit submissions but cannot approve one without evidence", () => {
		const team = fresh();
		const entry = team.tasks.build;
		if (!entry) throw new Error("missing task");
		const limited = {
			...team,
			tasks: {
				...team.tasks,
				build: { ...entry, context: { ...entry.context, revisionLimit: 0 } },
			},
		};
		const checked = withVerification(limited, "build", evidence(limited));
		const submitted = applyTask(checked, "build", {
			type: "SUBMIT",
			report: "report",
		}).team;
		const blocked = applyTask(submitted, "build", {
			type: "REVISE",
			feedback: "more",
		}).team;
		expect(blocked.tasks.build?.verification).toEqual(
			checked.tasks.build?.verification,
		);
		expect(
			decide(blocked, "build", { decision: "approve" })?.team.tasks.build
				?.status,
		).toBe("approved");
		expect(
			decide(withVerification(blocked, "build", undefined), "build", {
				decision: "approve",
			}),
		).toBeUndefined();
	});
	it("rejects generic approve of verification blocks, allowing explicit human feedback", () => {
		const team = applyTask(fresh(), "build", {
			type: "BLOCK",
			reason: "verification",
		}).team;
		expect(decide(team, "build", { decision: "approve" })).toBeUndefined();
		expect(
			decide(team, "build", {
				decision: "revise",
				feedback: "Inspected effects; retry.",
			})?.team.tasks.build?.status,
		).toBe("in_progress");
	});
	it("refuses human acceptance of a submitted report without eligible evidence", () => {
		const team = fresh();
		const submitted = applyTask(team, "build", {
			type: "SUBMIT",
			report: "report",
		}).team;
		const waiting = {
			...submitted,
			template: {
				...submitted.template,
				policies: {
					...submitted.template.policies,
					human_checkpoints: ["build"],
				},
			},
		};
		expect(decide(waiting, "build", { decision: "approve" })).toBeUndefined();
	});
	it("binds a known SHA-256 to the masked report bytes", () => {
		expect(reportSha256("hello")).toBe(
			"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	});
	it("keeps tasks with no configured gates vacuously eligible in strict mode", () => {
		const team = fresh();
		const unchecked = {
			...team,
			template: {
				...team.template,
				tasks: team.template.tasks.map((task) => ({ ...task, verify: [] })),
			},
		};
		expect(unchecked.verificationVersion).toBe(1);
		expect(eligibleVerification(unchecked, "build", "report")).toBe(true);
	});
});
