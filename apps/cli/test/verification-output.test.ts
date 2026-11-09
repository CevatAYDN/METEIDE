import { parseEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { eventLine, historyLine, namesOf } from "../src/domain/format.js";

const identity = {
	evaluationId: crypto.randomUUID(),
	attemptId: crypto.randomUUID(),
	index: 0,
};
const envelope = {
	id: crypto.randomUUID(),
	ts: "2026-11-08T10:00:00.000Z",
	schema: 1,
	workspaceId: crypto.randomUUID(),
	runId: crypto.randomUUID(),
	taskId: crypto.randomUUID(),
	source: "core-engine",
};
const gate = {
	index: 0,
	gate: "shell.exec@1",
	optional: false,
	details: "",
};
const title = () => "Build";
const eventOf = (input: unknown) => {
	const result = parseEvent(input);
	if (!result.ok) throw new Error("Invalid verification event fixture");
	return result.value;
};
const evaluated = (result: unknown) =>
	eventOf({
		...envelope,
		type: "verify.evaluated",
		payload: { ...identity, attemptNumber: 2, result },
	});

describe("CLI verification evidence output", () => {
	it("keeps complete evidence identity and diagnostics in ordinary history", () => {
		const details = "The executable returned exit code 1.\nAssertion failed.";
		const event = evaluated({ ...gate, status: "failed", details });
		const history = historyLine(event, namesOf([]));
		expect(history).toContain(JSON.stringify(event.payload));
		expect(history).toContain(identity.evaluationId);
		expect(history).toContain(identity.attemptId);
		expect(history).toContain("Assertion failed.");
		expect(eventLine(event, title)).not.toContain(details);
	});

	it("labels an update as a wakeup without claiming a running or final result", () => {
		const event = eventOf({
			...envelope,
			type: "verify.updated",
			payload: identity,
		});
		expect(eventLine(event, title)).toBe(
			"verify Build: evidence updated (gate 1)",
		);
	});

	it.each(["passed", "failed"] as const)(
		"shows executed %s distinctly",
		(status) => {
			expect(eventLine(evaluated({ ...gate, status }), title)).toBe(
				`verify Build: shell.exec@1 [gate 1, attempt 2, required] ${status}`,
			);
		},
	);

	it.each([
		"not_reached",
		"capability_missing",
		"approval_required",
		"denied",
		"unsupported_expect",
	] as const)("keeps %s as not run rather than failed or passed", (reason) => {
		const event = evaluated({ ...gate, status: "not_run", reason });
		expect(eventLine(event, title)).toBe(
			`verify Build: shell.exec@1 [gate 1, attempt 2, required] not run (${reason})`,
		);
	});

	it("does not claim an interrupted operation never ran", () => {
		const event = evaluated({
			...gate,
			status: "not_run",
			reason: "interrupted",
		});
		expect(eventLine(event, title)).toBe(
			"verify Build: shell.exec@1 [gate 1, attempt 2, required] outcome uncertain (interrupted)",
		);
		expect(historyLine(event, namesOf([]))).toContain(
			JSON.stringify(event.payload),
		);
	});

	it("retains optionality and repeated gate positions instead of collapsing names", () => {
		const event = eventOf({
			...envelope,
			type: "verify.evaluated",
			payload: {
				...identity,
				index: 1,
				attemptNumber: 3,
				result: {
					...gate,
					index: 1,
					optional: true,
					status: "not_run",
					reason: "denied",
				},
			},
		});
		expect(eventLine(event, title)).toBe(
			"verify Build: shell.exec@1 [gate 2, attempt 3, optional] not run (denied)",
		);
	});

	it.each([true, false])(
		"preserves legacy verify.completed formatting for ok=%s",
		(ok) => {
			const payload = { gate: "shell.exec@1", ok, details: "legacy output" };
			const event = eventOf({
				...envelope,
				type: "verify.completed",
				payload,
			});
			expect(eventLine(event, title)).toBeUndefined();
			expect(historyLine(event, namesOf([]))).toContain(
				JSON.stringify(payload),
			);
		},
	);
});
