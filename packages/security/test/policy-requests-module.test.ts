import type {
	PolicyCheckAdapter,
	PolicyRequestsAdapter,
} from "@mete/contracts";
import { expect, it } from "vitest";
import { setup } from "./setup.js";

it("registers exact requests with masked display and process-local lifetime", async () => {
	const s = await setup();
	await s.security.activate(s.ctx);
	try {
		expect(s.security.manifest.provides).toContain("policy.requests@1");
		const resolved =
			s.registry.resolve<PolicyRequestsAdapter>("policy.requests@1");
		if (!resolved.ok) throw new Error("policy.requests@1 missing");
		const requests = resolved.value[0].impl;
		expect(requests).not.toHaveProperty("remember");
		expect(requests).not.toHaveProperty("take");
		const check = s.impl<PolicyCheckAdapter>("policy.check@1");
		const identity = {
			runId: crypto.randomUUID(),
			agentId: crypto.randomUUID(),
		};
		const secret = `ghp_${"A1b2C3d4E5".repeat(3)}aBcDeF`;
		const command = `test ${secret}`;
		const input = {
			...identity,
			action: "shell.exec" as const,
			capability: "shell.exec@1" as const,
			adapterId: "test-adapter",
			args: { command },
			command,
		};
		expect(check.check(input)).toMatchObject({
			ok: true,
			value: { verdict: "ask" },
		});
		const result = await requests.pending(identity);
		if (!result.ok || !result.value.requests[0]) throw new Error("missing ask");
		const request = result.value.requests[0];
		expect(request.ask.command).toMatch(/^test \[SECRET:[0-9a-f]{8}\]$/);
		expect(JSON.stringify(result)).not.toContain(secret);
		expect(request).not.toHaveProperty("args");
		expect(
			requests.grant({
				...identity,
				requestId: request.requestId,
				scope: "task",
			}),
		).toEqual({ ok: true, value: undefined });
		expect(check.check(input)).toEqual({
			ok: true,
			value: { verdict: "allow", rule: "granted:task" },
		});
		await s.security.deactivate();
		expect(s.registry.has("policy.requests@1")).toBe(false);
		await s.security.activate(s.ctx);
		const fresh =
			s.registry.resolve<PolicyRequestsAdapter>("policy.requests@1");
		if (!fresh.ok) throw new Error("policy.requests@1 missing after restart");
		expect(await fresh.value[0].impl.pending(identity)).toEqual({
			ok: true,
			value: { requests: [] },
		});
		expect(
			s.impl<PolicyCheckAdapter>("policy.check@1").check(input),
		).toMatchObject({ ok: true, value: { verdict: "ask" } });
	} finally {
		await s.security.deactivate();
		await s.storage.deactivate();
	}
});

it("clears retained requests after the real audit writer fails", async () => {
	const s = await setup();
	await s.security.activate(s.ctx);
	try {
		const resolved =
			s.registry.resolve<PolicyRequestsAdapter>("policy.requests@1");
		if (!resolved.ok) throw new Error("policy.requests@1 missing");
		const requests = resolved.value[0].impl;
		const identity = {
			runId: crypto.randomUUID(),
			agentId: crypto.randomUUID(),
		};
		const input = {
			...identity,
			action: "shell.exec" as const,
			capability: "shell.exec@1" as const,
			adapterId: "test-adapter",
			command: "test",
			args: { command: "test" },
		};
		const check = s.impl<PolicyCheckAdapter>("policy.check@1");
		check.check(input);
		const pending = await requests.pending(identity);
		if (!pending.ok || !pending.value.requests[0])
			throw new Error("missing request");
		s.scoped.workspace.exec("DROP TABLE audit_log");
		expect(check.check(input)).toMatchObject({
			ok: false,
			error: { code: "audit_failed" },
		});
		expect(await requests.pending(identity)).toEqual({
			ok: true,
			value: { requests: [] },
		});
		expect(
			requests.grant({
				...identity,
				requestId: pending.value.requests[0].requestId,
				scope: "once",
			}),
		).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
	} finally {
		await s.security.deactivate();
		await s.storage.deactivate();
	}
});
