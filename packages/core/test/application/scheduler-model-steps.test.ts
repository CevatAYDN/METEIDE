import { type ChatMessage, ok } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMachine } from "../../src/domain/run-machine.js";
import { engineHarness, reply } from "../helpers/engine.js";
import {
	gatedReply,
	gatedStream,
	type SchedulerHarness,
	schedulerHarness,
	stateOf,
	untilRequests,
	untilStatus,
} from "../helpers/scheduler.js";

let held: SchedulerHarness | undefined;
afterEach(async () => {
	await held?.cleanup();
	held = undefined;
});

describe("parallel worker model steps", () => {
	it("executes tools sequentially and feeds each result only to its own model session", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const paths: string[] = [];
		const a = gatedStream(
			reply("", [{ name: "fs_read", args: { path: "a" } }]),
		);
		const b = gatedStream(
			reply("", [{ name: "fs_read", args: { path: "b" } }]),
		);
		held = await schedulerHarness({
			scripts: [
				a.script,
				b.script,
				reply("done"),
				reply("done"),
				reply("done"),
				reply("done"),
			],
			rewrite: (source) =>
				source.replaceAll("capabilities: []", "capabilities: [fs.read@1]"),
			tools: [
				[
					"fs.read@1",
					async (input) => {
						const path = (input as { path: string }).path;
						paths.push(path);
						if (path === "a") await gate;
						return ok({
							content: `result-${path}`,
							totalLines: 1,
							lineEnding: "lf",
						});
					},
				],
			],
		});
		const h = held;
		try {
			await untilRequests(h, 2);
			a.release();
			b.release();
			await vi.waitFor(() => expect(paths).toEqual(["a"]));
		} finally {
			release();
		}
		await untilStatus(h, "completed");
		expect(paths).toEqual(["a", "b"]);
		const tasks = stateOf(h)?.context.team?.tasks;
		const results = (id: string) =>
			tasks?.[id]?.messages.filter((m) => m.role === "tool");
		expect(JSON.stringify(results("a"))).toContain("result-a");
		expect(JSON.stringify(results("a"))).not.toContain("result-b");
		expect(JSON.stringify(results("b"))).toContain("result-b");
	});

	it.each([false, true])(
		"uses the last slot for a summary, including too_large retry=%s, without a peer call or extra turn",
		async (rejected) => {
			const a = gatedReply("old-a");
			const b = gatedReply("old-b");
			held = await schedulerHarness({ scripts: [a.script, b.script] });
			const h = held;
			await untilRequests(h, 2);
			await h.engine.pause(h.runId);
			await h.stop();
			const row = h.store.load(h.runId);
			const saved = row?.snapshot;
			const entry = saved?.context.team?.tasks.a;
			if (!row || !saved || !entry?.session) throw new Error("missing session");
			const history: ChatMessage[] = Array.from({ length: 7 }, (_, i) => ({
				role: "assistant",
				content: `turn-${i} ${"long ".repeat(100)}`,
			}));
			entry.messages = [
				...entry.messages.slice(0, 2),
				...history,
				{ role: "user", content: "continue" },
			];
			entry.session = {
				...entry.session,
				turns: 7,
				agent: {
					id: entry.context.agentId ?? "",
					roleId: "first",
					providerId: "p",
					modelId: "small",
					contextWindow: rejected ? 100_000 : 100,
				},
			};
			h.store.save(
				row.meta,
				runMachine.resolveState({ value: "paused", context: saved.context }),
			);
			const later = engineHarness({
				scripts: rejected
					? [
							[
								{
									type: "error",
									error: { code: "too_large", message: "fold first" },
								},
							],
							reply("summary"),
						]
					: [reply("summary")],
				db: h.db,
				templates: h.templates,
				policy: { budget: { cloud_requests_per_run: 1 } },
			});
			expect((await later.engine.resume(h.runId)).ok).toBe(true);
			await vi.waitFor(() =>
				expect(h.store.load(h.runId)?.snapshot.context.pause?.reason).toBe(
					"budget",
				),
			);
			const context = h.store.load(h.runId)?.snapshot.context;
			expect(later.requests).toHaveLength(rejected ? 2 : 1);
			expect(later.requests.at(-1)?.messages[0]?.content).toContain(
				"Summarize",
			);
			expect(context?.requests).toBe(1);
			expect(context?.reservations).toEqual([]);
			expect(context?.team?.tasks.a?.session?.turns).toBe(7);
			expect(context?.team?.tasks.a?.messages[2]?.content).toContain(
				"<summary>",
			);
			await later.stop();
			a.release();
			b.release();
		},
	);
});
