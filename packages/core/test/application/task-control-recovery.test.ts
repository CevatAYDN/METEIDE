import { ok } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMachine } from "../../src/domain/run-machine.js";
import { engineHarness, reply } from "../helpers/engine.js";
import { policyRequestsFixture } from "../helpers/policy-requests.js";
import { schedulerHarness, untilStatus } from "../helpers/scheduler.js";
import { controlHarness } from "../helpers/task-control.js";

let cleanup = async () => {};
afterEach(async () => {
	await cleanup();
	cleanup = async () => {};
});

describe("task control recovery", () => {
	it("does not bypass interrupted setup when resuming in the same process", async () => {
		const h = controlHarness("user");
		cleanup = async () => {
			await h.stop();
			h.db.close();
		};
		const row = h.store.load(h.runId);
		const team = row?.snapshot.context.team;
		if (!row || !team?.tasks.a) throw new Error("fixture missing");
		h.store.save(
			row.meta,
			runMachine.resolveState({
				value: row.snapshot.value,
				context: {
					...row.snapshot.context,
					team: {
						...team,
						tasks: {
							...team.tasks,
							a: { ...team.tasks.a, status: "in_progress", setup: "running" },
						},
					},
				},
			}),
		);
		expect((await h.engine.resume(h.runId)).ok).toBe(true);
		await vi.waitFor(() =>
			expect(h.store.load(h.runId)?.snapshot.context.team?.tasks.a?.setup).toBe(
				"uncertain",
			),
		);
		expect(h.requests).toEqual([]);
		const result = await h.tasks.pending({ runId: h.runId });
		expect(
			result.ok &&
				result.value.requests.some(
					(r) => r.kind === "blocked" && r.reason === "setup_interrupted",
				),
		).toBe(true);
	});

	it("expires policy identities across restart without replaying before resume", async () => {
		const oldPolicy = policyRequestsFixture();
		const first = await schedulerHarness({
			scripts: [
				reply("", [
					{ name: "web_fetch", args: { url: "https://example.test/a" } },
				]),
				reply("", [
					{ name: "web_fetch", args: { url: "https://example.test/b" } },
				]),
			],
			rewrite: (source) =>
				source
					.replace("  - { id: c, role: first, title: Task C }\n", "")
					.replace(
						"  - { id: d, role: second, title: Task D, context: [a, b] }\n",
						"",
					)
					.replaceAll("capabilities: []", "capabilities: [web.fetch@1]"),
			tools: [["web.fetch@1", oldPolicy.run]],
			configure: ({ registry }) =>
				registry.provide("policy.requests@1", {
					id: "security",
					trust: "core",
					features: [],
					impl: oldPolicy.port,
				}),
		});
		cleanup = first.cleanup;
		await untilStatus(first, "paused");
		const old = await first.tasks.pending({ runId: first.runId });
		if (!old.ok) throw new Error("old requests missing");
		await first.stop();
		const freshPolicy = policyRequestsFixture();
		const second = engineHarness({
			db: first.db,
			templates: first.templates,
			scripts: [reply("done")],
			tools: [["web.fetch@1", freshPolicy.run]],
		});
		second.registry.provide("policy.requests@1", {
			id: "security",
			trust: "core",
			features: [],
			impl: freshPolicy.port,
		});
		cleanup = async () => {
			await second.stop();
			await first.cleanup();
		};
		second.recover();
		expect(freshPolicy.calls).toEqual([]);
		for (const request of old.value.requests) {
			expect(
				(
					await second.tasks.answer({
						runId: first.runId,
						taskId: request.taskId,
						requestId: request.requestId,
						decision: "allow",
						scope: "once",
					})
				).ok,
			).toBe(false);
		}
		expect((await second.engine.resume(first.runId)).ok).toBe(true);
		await vi.waitFor(() => expect(freshPolicy.calls).toHaveLength(2));
		await vi.waitFor(() =>
			expect(second.store.load(first.runId)?.snapshot.value).toBe("paused"),
		);
		const renewed = await second.tasks.pending({ runId: first.runId });
		if (!renewed.ok) throw new Error("renewed requests missing");
		expect(renewed.value.requests).toHaveLength(2);
		expect(
			renewed.value.requests.every(
				(r) =>
					!old.value.requests.some((prior) => prior.requestId === r.requestId),
			),
		).toBe(true);
	});

	it("holds interrupted setup until an explicit task answer and preserves a user pause", async () => {
		const h = controlHarness("user");
		cleanup = async () => {
			await h.stop();
			h.db.close();
		};
		const row = h.store.load(h.runId);
		const team = row?.snapshot.context.team;
		if (!row || !team?.tasks.a) throw new Error("fixture missing");
		h.store.save(
			row.meta,
			runMachine.resolveState({
				value: row.snapshot.value,
				context: {
					...row.snapshot.context,
					team: {
						...team,
						tasks: {
							...team.tasks,
							a: { ...team.tasks.a, status: "in_progress", setup: "running" },
						},
					},
				},
			}),
		);
		h.recover();
		expect(h.requests).toEqual([]);
		const pending = await h.tasks.pending({ runId: h.runId });
		if (!pending.ok) throw new Error("pending failed");
		const request = pending.value.requests.find(
			(r) => r.templateTaskId === "a",
		);
		if (!request) throw new Error("setup request missing");
		expect(request).toMatchObject({
			kind: "blocked",
			reason: "setup_interrupted",
		});
		expect(h.store.load(h.runId)?.snapshot.context.team?.tasks.a?.setup).toBe(
			"uncertain",
		);
		expect(
			await h.tasks.answer({
				runId: h.runId,
				taskId: request.taskId,
				requestId: request.requestId,
				decision: "answer",
				feedback: "Effects checked; retry setup",
			}),
		).toEqual(ok(undefined));
		expect(h.store.load(h.runId)?.snapshot.context.team?.tasks.a?.setup).toBe(
			"pending",
		);
		expect(h.store.load(h.runId)?.snapshot.context.pause?.reason).toBe("user");
		expect(h.requests).toEqual([]);
	});
});
