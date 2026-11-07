import { describe, expect, expectTypeOf, it } from "vitest";
import {
	PolicyForgetInputSchema,
	PolicyGrantRequestSchema,
	PolicyPendingInputSchema,
	PolicyPendingResultSchema,
	type PolicyRequest,
	type PolicyRequestError,
	PolicyRequestErrorSchema,
	PolicyRequestSchema,
	type PolicyRequestsAdapter,
} from "../../src/domain/policy-requests.js";
import type { Result } from "../../src/domain/result.js";

const runId = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const agentId = "8f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const requestId = "9f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const identity = { runId, agentId, requestId };
const ask = {
	action: "fs.write",
	capability: "fs.write@1",
	adapterId: "test-adapter",
	path: "src/file.ts",
} as const;
const request = { ...identity, ask, rule: "autonomy" };

describe("policy.requests@1 request", () => {
	it("preserves exact identity and the existing masked ask shape", () => {
		expect(PolicyRequestSchema.parse(request)).toEqual(request);
		const command = {
			...request,
			ask: {
				action: "shell.exec",
				capability: "shell.exec@1",
				adapterId: "test-adapter",
				command: "test [SECRET:12345678]",
			},
		};
		expect(PolicyRequestSchema.parse(command)).toEqual(command);
		expect(PolicyPendingResultSchema.parse({ requests: [] })).toEqual({
			requests: [],
		});
		expect(PolicyPendingResultSchema.parse({ requests: [request] })).toEqual({
			requests: [request],
		});
	});

	it("rejects invalid or missing ids, empty rules and extra fields", () => {
		for (const key of ["runId", "agentId", "requestId"])
			for (const value of ["not-a-uuid", undefined])
				expect(
					PolicyRequestSchema.safeParse({ ...request, [key]: value }).success,
				).toBe(false);
		for (const bad of [
			{ ...request, rule: "" },
			{ ...request, extra: true },
			{ ...request, ask: { ...ask, args: {} } },
			{ ...request, ask: { ...ask, action: "unknown" } },
		])
			expect(PolicyRequestSchema.safeParse(bad).success).toBe(false);
		for (const bad of [
			{ requests: [request], extra: true },
			{ requests: [{ ...request, requestId: "bad" }] },
		])
			expect(PolicyPendingResultSchema.safeParse(bad).success).toBe(false);
	});
});

describe("policy.requests@1 inputs", () => {
	it("lists one agent's requests and forgets one agent or the whole run", () => {
		expect(PolicyPendingInputSchema.parse({ runId, agentId })).toEqual({
			runId,
			agentId,
		});
		for (const input of [{ runId }, { runId, agentId }])
			expect(PolicyForgetInputSchema.parse(input)).toEqual(input);
	});

	it("grants only an exact request once or for the task", () => {
		for (const scope of ["once", "task"])
			expect(PolicyGrantRequestSchema.parse({ ...identity, scope })).toEqual({
				...identity,
				scope,
			});
	});

	it("rejects malformed grant identities", () => {
		const grant = { ...identity, scope: "once" };
		for (const key of ["runId", "agentId", "requestId"])
			for (const value of ["bad", undefined])
				expect(
					PolicyGrantRequestSchema.safeParse({ ...grant, [key]: value })
						.success,
				).toBe(false);
	});

	it("rejects replacement actions, legacy scopes and invalid pending or forget inputs", () => {
		const grant = { ...identity, scope: "once" };
		for (const bad of [
			{ ...grant, scope: "run" },
			{ ...grant, scope: "always" },
			{ ...grant, ask },
			{ ...grant, command: "replacement" },
			{ ...grant, path: "replacement" },
			{ ...grant, extra: true },
		])
			expect(PolicyGrantRequestSchema.safeParse(bad).success).toBe(false);
		for (const bad of [
			{ runId },
			{ runId: "bad", agentId },
			{ runId, agentId: "bad" },
			{ runId, agentId, extra: true },
		])
			expect(PolicyPendingInputSchema.safeParse(bad).success).toBe(false);
		for (const bad of [
			{},
			{ runId: "bad" },
			{ runId, agentId: "bad" },
			{ runId, requestId },
		])
			expect(PolicyForgetInputSchema.safeParse(bad).success).toBe(false);
	});
});

describe("policy.requests@1 errors and adapter", () => {
	it("accepts only the documented error codes and message", () => {
		for (const code of ["bad_input", "not_found", "failed"])
			expect(
				PolicyRequestErrorSchema.parse({ code, message: "refused" }),
			).toEqual({ code, message: "refused" });
		for (const bad of [
			{ code: "denied", message: "refused" },
			{ code: "failed" },
			{ code: "failed", message: "refused", extra: true },
		])
			expect(PolicyRequestErrorSchema.safeParse(bad).success).toBe(false);
	});

	it("keeps pending asynchronous and grant and forget synchronous Results", () => {
		expectTypeOf<ReturnType<PolicyRequestsAdapter["pending"]>>().toEqualTypeOf<
			Promise<Result<{ requests: PolicyRequest[] }, PolicyRequestError>>
		>();
		expectTypeOf<ReturnType<PolicyRequestsAdapter["grant"]>>().toEqualTypeOf<
			Result<void, PolicyRequestError>
		>();
		expectTypeOf<ReturnType<PolicyRequestsAdapter["forget"]>>().toEqualTypeOf<
			Result<void, PolicyRequestError>
		>();
	});
});
