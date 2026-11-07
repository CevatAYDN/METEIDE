import {
	err,
	ok,
	type PolicyGrantRequest,
	type PolicyRequestsAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMachine } from "../../src/domain/run-machine.js";
import { waitSignature } from "../../src/domain/task-wait.js";
import { controlHarness } from "../helpers/task-control.js";

let held: ReturnType<typeof controlHarness> | undefined;
afterEach(async () => {
	await held?.stop();
	held?.db.close();
	held = undefined;
});

const prepared = (expired = false) => {
	held = controlHarness("user");
	const h = held;
	const loaded = h.store.load(h.runId);
	const team = loaded?.snapshot.context.team;
	const entry = team?.tasks.a;
	if (!loaded || !team || !entry?.context.agentId)
		throw new Error("missing fixture");
	const request = {
		runId: h.runId,
		taskId: entry.id,
		requestId: crypto.randomUUID(),
		templateTaskId: "a",
		title: "Task a",
		agentId: entry.context.agentId,
		kind: "policy" as const,
		rule: "ask",
		ask: {
			action: "fs.write" as const,
			capability: "fs.write@1" as const,
			adapterId: "fixture",
			path: "[SECRET:masked]",
		},
	};
	h.store.save(
		loaded.meta,
		runMachine.resolveState({
			value: loaded.snapshot.value,
			context: {
				...loaded.snapshot.context,
				team: {
					...team,
					tasks: {
						...team.tasks,
						a: {
							...entry,
							wait: { request, signature: waitSignature(entry), stage: "tool" },
						},
					},
				},
			},
		}),
	);
	const grants: PolicyGrantRequest[] = [];
	h.registry.provide<PolicyRequestsAdapter>("policy.requests@1", {
		id: "security",
		trust: "core",
		features: [],
		impl: {
			pending: async () => ok({ requests: [] }),
			grant: (input) => {
				if (expired) return err({ code: "not_found", message: "expired" });
				grants.push(input);
				return ok(undefined);
			},
			forget: () => ok(undefined),
		},
	});
	return { h, request, grants };
};

describe("exact task policy answer", () => {
	it("does not grant before the wait removal is durably saved and allows a retry after save failure", async () => {
		const { h, request, grants } = prepared();
		const answer = {
			runId: h.runId,
			taskId: request.taskId,
			requestId: request.requestId,
			decision: "allow" as const,
			scope: "once" as const,
		};
		const saving = vi.spyOn(h.store, "save").mockImplementationOnce(() => {
			throw new Error("storage unavailable");
		});
		expect(await h.tasks.answer(answer)).toMatchObject({
			ok: false,
			error: { code: "failed" },
		});
		expect(grants).toEqual([]);
		expect(
			h.store.load(h.runId)?.snapshot.context.team?.tasks.a?.wait?.request
				.requestId,
		).toBe(request.requestId);
		saving.mockRestore();
		expect((await h.tasks.answer(answer)).ok).toBe(true);
		expect(grants).toHaveLength(1);
	});

	it("grants only the retained identity and never sends displayed command/path back", async () => {
		const { h, request, grants } = prepared();
		const answer = {
			runId: h.runId,
			taskId: request.taskId,
			requestId: request.requestId,
			decision: "allow" as const,
			scope: "once" as const,
		};
		expect((await h.tasks.answer(answer)).ok).toBe(true);
		expect(grants).toEqual([
			{
				runId: h.runId,
				agentId: request.agentId,
				requestId: request.requestId,
				scope: "once",
			},
		]);
		expect((await h.tasks.answer(answer)).ok).toBe(false);
		expect(grants).toHaveLength(1);
		expect(h.store.load(h.runId)?.snapshot.context.pause?.reason).toBe("user");
	});

	it("retains the wait if security has expired the request", async () => {
		const { h, request, grants } = prepared(true);
		expect(
			(
				await h.tasks.answer({
					runId: h.runId,
					taskId: request.taskId,
					requestId: request.requestId,
					decision: "allow",
					scope: "task",
				})
			).ok,
		).toBe(false);
		expect(grants).toEqual([]);
		expect(
			h.store.load(h.runId)?.snapshot.context.team?.tasks.a?.wait?.request
				.requestId,
		).toBe(request.requestId);
	});
});
