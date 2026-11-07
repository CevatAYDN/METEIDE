import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type EventsReadAdapter,
	err,
	type MeteEvent,
	ok,
	type PolicyGrantAdapter,
	type RunView,
	type TaskControlAdapter,
	type TaskPending,
	type TeamEngineAdapter,
} from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowAndResume } from "../src/application/allow.js";
import type { App } from "../src/infrastructure/app.js";
import { tempRepo } from "./helpers.js";

const identity = {
	runId: crypto.randomUUID(),
	taskId: crypto.randomUUID(),
	requestId: crypto.randomUUID(),
};
const ask = {
	action: "shell.exec",
	capability: "shell.exec@1",
	adapterId: "tools-shell",
	command: "node --version",
} as const;
const task = { ...identity, templateTaskId: "write", title: "Write" };
const policy: TaskPending = {
	...task,
	kind: "policy",
	ask,
	rule: "test",
};
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of closes.splice(0)) await close();
});
const setup = async (support = true) => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	closes.push(repo.close);
	const registry = createCapabilityRegistry(() => []);
	// allowAndResume consults only these App fields; every port below is a handwritten fake.
	const app = { registry, workspaceDir: repo.workspaceDir } as App;
	const pending = vi.fn<TaskControlAdapter["pending"]>(async () =>
		ok({ requests: [policy] }),
	);
	const answer = vi.fn<TaskControlAdapter["answer"]>(async () => ok(undefined));
	if (support)
		registry.provide<TaskControlAdapter>("task.control@1", {
			id: "tasks",
			trust: "core",
			features: [],
			impl: { pending, answer },
		});
	const grant = vi.fn<PolicyGrantAdapter["grant"]>();
	registry.provide<PolicyGrantAdapter>("policy.grant@1", {
		id: "grants",
		trust: "core",
		features: [],
		impl: { grant },
	});
	const event: MeteEvent = {
		id: crypto.randomUUID(),
		ts: new Date().toISOString(),
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId: identity.runId,
		source: "test",
		type: "policy.asked",
		payload: { ...ask, rule: "test" },
	};
	registry.provide<EventsReadAdapter>("events.read@1", {
		id: "events",
		trust: "core",
		features: [],
		impl: { read: () => ({ events: [event], broken: [] }) },
	});
	const view: RunView = {
		id: identity.runId,
		workspaceId: event.workspaceId,
		templateId: null,
		goal: "test",
		status: "paused",
		pauseReason: "approval",
		autonomyLevel: 1,
		budget: { cloudRequests: 1, maxHours: 1 },
		createdAt: event.ts,
	};
	const status = vi.fn<TeamEngineAdapter["status"]>(() => ok([view]));
	const resume = vi.fn<TeamEngineAdapter["resume"]>(async () => ok(undefined));
	const engine: TeamEngineAdapter = {
		status,
		resume,
		start: async () => ok({ runId: identity.runId }),
		pause: async () => ok(undefined),
		cancel: async () => ok(undefined),
		approve: async () => ok(undefined),
	};
	return { app, engine, pending, answer, grant, resume, status };
};
const allow = (
	t: Awaited<ReturnType<typeof setup>>,
	scope: "once" | "run" | "always",
) => allowAndResume(t.app, t.engine, identity.runId, scope);

describe("legacy allow with exact task controls", () => {
	it("routes once and old run scopes without a legacy grant or full resume", async () => {
		const t = await setup();
		t.pending.mockResolvedValue(
			ok({
				requests: [
					policy,
					{ ...task, requestId: crypto.randomUUID(), kind: "approval" },
				],
			}),
		);
		for (const scope of ["once", "run"] as const) {
			expect(await allow(t, scope)).toEqual(ok(undefined));
			expect(t.answer).toHaveBeenLastCalledWith({
				...identity,
				decision: "allow",
				scope: scope === "run" ? "task" : "once",
			});
		}
		expect(t.pending).toHaveBeenCalledWith({ runId: identity.runId });
		expect(t.grant).not.toHaveBeenCalled();
		expect(t.resume).not.toHaveBeenCalled();
		expect(t.status).not.toHaveBeenCalled();
	});

	it("refuses ambiguous policy waits and asks for a specific task", async () => {
		const t = await setup();
		t.pending.mockResolvedValue(
			ok({
				requests: [
					policy,
					{
						...policy,
						taskId: crypto.randomUUID(),
						requestId: crypto.randomUUID(),
					},
				],
			}),
		);
		expect(await allow(t, "once")).toMatchObject({
			ok: false,
			error: {
				code: "bad_input",
				message: expect.stringContaining("specific task"),
			},
		});
		expect(t.answer).not.toHaveBeenCalled();
		expect(t.grant).not.toHaveBeenCalled();
		expect(t.resume).not.toHaveBeenCalled();
	});

	it("rejects Always for task waits without writing configuration", async () => {
		const t = await setup();
		expect(await allow(t, "always")).toMatchObject({
			ok: false,
			error: { code: "bad_input" },
		});
		await expect(
			readFile(join(t.app.workspaceDir, ".mete", "policy.yaml")),
		).rejects.toThrow();
		expect(t.answer).not.toHaveBeenCalled();
		expect(t.grant).not.toHaveBeenCalled();
		expect(t.resume).not.toHaveBeenCalled();
	});

	it("does not grant a stale policy event when tasks wait on another kind", async () => {
		const t = await setup();
		for (const wait of [
			{ ...task, kind: "approval" },
			{ ...task, kind: "clarification", question: "Which?" },
			{ ...task, kind: "blocked", reason: "review" },
			{ ...task, kind: "merge", message: "conflict" },
		] satisfies TaskPending[]) {
			t.pending.mockResolvedValue(ok({ requests: [wait] }));
			expect(await allow(t, "once")).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
		}
		expect(t.answer).not.toHaveBeenCalled();
		expect(t.grant).not.toHaveBeenCalled();
		expect(t.resume).not.toHaveBeenCalled();
	});

	it("preserves single-run grants with an empty pending list or absent port", async () => {
		for (const support of [true, false]) {
			const t = await setup(support);
			t.pending.mockResolvedValue(ok({ requests: [] }));
			expect(await allow(t, "run")).toEqual(ok(undefined));
			expect(t.grant).toHaveBeenCalledWith({
				runId: identity.runId,
				scope: "run",
				ask,
			});
			expect(t.resume).toHaveBeenCalledWith(identity.runId);
			expect(t.answer).not.toHaveBeenCalled();
		}
	});

	it("does not grant a team's historical event when its exact pending list is empty", async () => {
		const t = await setup();
		t.pending.mockResolvedValue(ok({ requests: [] }));
		const viewed = t.status(identity.runId);
		if (!viewed.ok) throw new Error("fixture status failed");
		t.status.mockReturnValue(
			ok(viewed.value.map((run) => ({ ...run, templateId: "team" }))),
		);
		expect(await allow(t, "once")).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
		expect(t.grant).not.toHaveBeenCalled();
		expect(t.resume).not.toHaveBeenCalled();
	});

	it("propagates pending and answer failures without falling back", async () => {
		const t = await setup();
		t.pending.mockResolvedValue(err({ code: "not_found", message: "no run" }));
		expect(await allow(t, "once")).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
		t.pending.mockResolvedValue(ok({ requests: [policy] }));
		t.answer.mockResolvedValue(err({ code: "bad_input", message: "stale" }));
		expect(await allow(t, "once")).toMatchObject({
			ok: false,
			error: { code: "bad_input" },
		});
		expect(t.grant).not.toHaveBeenCalled();
		expect(t.resume).not.toHaveBeenCalled();
	});

	it("refuses malformed or cross-run pending data before granting", async () => {
		const t = await setup();
		for (const output of [
			{ requests: [policy], extra: true },
			{ requests: [{ ...policy, runId: crypto.randomUUID() }] },
		]) {
			t.pending.mockResolvedValue(ok(output));
			expect(await allow(t, "once")).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
		}
		expect(t.answer).not.toHaveBeenCalled();
		expect(t.grant).not.toHaveBeenCalled();
		expect(t.resume).not.toHaveBeenCalled();
	});
});
