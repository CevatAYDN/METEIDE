import { type PolicyCheckInput, PolicySchema } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createGrants } from "../../src/application/grants.js";
import { createPolicyCheck } from "../../src/application/policy-check.js";
import { createPolicyRequests } from "../../src/application/policy-requests.js";

const identity = { runId: crypto.randomUUID(), agentId: crypto.randomUUID() };
const input: PolicyCheckInput = {
	...identity,
	action: "fs.write",
	capability: "fs.write@1",
	adapterId: "test-adapter",
	path: "/repo/a.ts",
	args: { content: "original" },
};
const env = (autonomy = 1) => ({
	policy: PolicySchema.parse({ autonomy }),
	workspaceDir: "/repo",
	globalDir: "/data",
	home: "/home",
	platform: "linux" as const,
});
const grant = async (
	requests: ReturnType<typeof createPolicyRequests>,
	scope: "once" | "task",
) => {
	const result = await requests.pending(identity);
	if (!result.ok || !result.value.requests[0])
		throw new Error("missing request");
	return requests.grant({
		...identity,
		requestId: result.value.requests[0].requestId,
		scope,
	});
};

describe("audited exact grants", () => {
	it("remembers synchronously after the audit and before the existing ask callback", async () => {
		const order: string[] = [];
		const requests = createPolicyRequests({
			mask: async (text) => text,
			newId: () => {
				order.push("remember");
				return crypto.randomUUID();
			},
		});
		const check = createPolicyCheck(
			() => env(),
			() => {
				order.push("audit");
			},
			{
				requests,
				asked: () => {
					order.push("asked");
				},
			},
		);
		expect(check.check(input)).toMatchObject({
			ok: true,
			value: { verdict: "ask" },
		});
		expect(order).toEqual(["audit", "remember", "asked"]);
		expect(await grant(requests, "once")).toEqual({
			ok: true,
			value: undefined,
		});
		expect(check.check(input)).toEqual({
			ok: true,
			value: { verdict: "allow", rule: "granted:once" },
		});
		expect(check.check(input)).toMatchObject({
			ok: true,
			value: { verdict: "ask" },
		});
	});

	it("never bypasses deny and consumes once even when the policy now denies", async () => {
		const requests = createPolicyRequests({ mask: async (text) => text });
		let autonomy = 1;
		const check = createPolicyCheck(
			() => env(autonomy),
			() => {},
			{ requests },
		);
		check.check(input);
		await grant(requests, "once");
		autonomy = 0;
		expect(check.check(input)).toEqual({
			ok: true,
			value: { verdict: "deny", rule: "autonomy:0" },
		});
		autonomy = 1;
		expect(check.check(input)).toMatchObject({
			ok: true,
			value: { verdict: "ask" },
		});
	});

	it("blocks task grants on taint, but permits an exact once answer on a tainted attempt", async () => {
		const requests = createPolicyRequests({ mask: async (text) => text });
		const check = createPolicyCheck(
			() => env(),
			() => {},
			{ requests },
		);
		check.check(input);
		await grant(requests, "task");
		const tainted = { ...input, tainted: true };
		expect(check.check(tainted)).toMatchObject({
			ok: true,
			value: { verdict: "ask" },
		});
		await grant(requests, "once");
		expect(check.check(tainted)).toMatchObject({
			ok: true,
			value: { rule: "granted:once" },
		});
		expect(check.check(tainted)).toMatchObject({
			ok: true,
			value: { verdict: "ask" },
		});
		expect(check.check(input)).toMatchObject({
			ok: true,
			value: { rule: "granted:task" },
		});
	});

	it("retains no request and announces no ask after audit failure", async () => {
		const requests = createPolicyRequests({ mask: async (text) => text });
		let asked = false;
		const check = createPolicyCheck(
			() => env(),
			() => {
				throw new Error("audit refused");
			},
			{
				requests,
				asked: () => {
					asked = true;
				},
			},
		);
		expect(check.check(input)).toEqual({
			ok: false,
			error: { code: "audit_failed", message: "audit refused" },
		});
		expect(await requests.pending(identity)).toEqual({
			ok: true,
			value: { requests: [] },
		});
		expect(asked).toBe(false);
	});

	it("forgets an earlier ask and its grants when a later audit fails", async () => {
		const requests = createPolicyRequests({ mask: async (text) => text });
		let fail = false;
		let asks = 0;
		const check = createPolicyCheck(
			() => env(),
			() => {
				if (fail) throw new Error("audit refused");
			},
			{
				requests,
				asked: () => {
					asks += 1;
				},
			},
		);
		check.check(input);
		await grant(requests, "task");
		const next = { ...input, args: { content: "changed" } };
		check.check(next);
		const pending = await requests.pending(identity);
		if (!pending.ok || !pending.value.requests[0])
			throw new Error("missing request");
		const stale = pending.value.requests[0].requestId;
		fail = true;
		expect(check.check(next)).toMatchObject({
			ok: false,
			error: { code: "audit_failed" },
		});
		expect(asks).toBe(2);
		expect(await requests.pending(identity)).toEqual({
			ok: true,
			value: { requests: [] },
		});
		expect(
			requests.grant({ ...identity, requestId: stale, scope: "once" }),
		).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
		expect(requests.take(input)).toBeUndefined();
	});

	it("keeps legacy grants as an unchanged fallback", () => {
		const requests = createPolicyRequests({ mask: async (text) => text });
		const grants = createGrants();
		grants.grant({
			runId: identity.runId,
			scope: "once",
			ask: {
				action: "fs.write",
				capability: "fs.write@1",
				adapterId: "test-adapter",
			},
		});
		const check = createPolicyCheck(
			() => env(),
			() => {},
			{ requests, grants },
		);
		expect(check.check(input)).toEqual({
			ok: true,
			value: { verdict: "allow", rule: "granted:once" },
		});
		expect(check.check(input)).toMatchObject({
			ok: true,
			value: { verdict: "ask" },
		});
	});
});
