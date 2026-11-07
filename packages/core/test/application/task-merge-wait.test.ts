import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, VcsGitInputSchema } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reply } from "../helpers/engine.js";
import {
	type SchedulerHarness,
	schedulerHarness,
	stateOf,
	untilStatus,
} from "../helpers/scheduler.js";

let held: SchedulerHarness | undefined;
afterEach(async () => {
	await held?.cleanup();
	held = undefined;
});
describe("task-local failed merge", () => {
	it("lets an independent task finish, retains the queue head, then retries the exact request", async () => {
		let reject = true;
		held = await schedulerHarness({
			scripts: [reply("done")],
			rewrite: (source) =>
				source
					.replace("  - { id: c, role: first, title: Task C }\n", "")
					.replace(
						"  - { id: d, role: second, title: Task D, context: [a, b] }\n",
						"",
					)
					.replace(
						"goal: Research first, tier: fast, capabilities: []",
						"goal: Research first, tier: fast, capabilities: [fs.write@1]",
					),
			tools: [
				[
					"vcs.git@2",
					async (raw) => {
						const input = VcsGitInputSchema.parse(raw);
						if (input.op === "worktree.create")
							return ok({
								op: input.op,
								path: join(tmpdir(), "mete-merge-wait", input.taskId),
								branch: input.taskId,
								sha: "base",
							});
						if (input.op === "checkpoint.create")
							return ok({ op: input.op, ref: "checkpoint", sha: "saved" });
						if (input.op === "merge" && reject)
							return err({
								code: "merge_conflict",
								message: "fixture conflict",
								paths: ["file.txt"],
							});
						return ok({ op: input.op, sha: "landed", removed: true });
					},
				],
			],
		});
		const h = held;
		await vi.waitFor(() =>
			expect(h.events.some((e) => e.type === "task.merge.failed")).toBe(true),
		);
		await vi.waitFor(() =>
			expect(stateOf(h)?.context.team?.tasks.b?.status).toBe("approved"),
		);
		await untilStatus(h, "paused");
		const pending = await h.tasks.pending({ runId: h.runId });
		if (!pending.ok || !pending.value.requests[0])
			throw new Error("missing merge request");
		const request = pending.value.requests[0];
		expect(request).toMatchObject({
			kind: "merge",
			templateTaskId: "a",
			paths: ["file.txt"],
		});
		expect(stateOf(h)?.context.team?.mergeQueue).toEqual(["a"]);
		reject = false;
		expect(
			(
				await h.tasks.answer({
					runId: h.runId,
					taskId: request.taskId,
					requestId: request.requestId,
					decision: "retry",
				})
			).ok,
		).toBe(true);
		await untilStatus(h, "completed");
	});
});
