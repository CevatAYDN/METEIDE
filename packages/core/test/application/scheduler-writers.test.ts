import { ok, WebFetchInputSchema } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parallelTool } from "../../src/application/worker-tool.js";
import { taskContext } from "../../src/domain/task-worker.js";
import { reply } from "../helpers/engine.js";
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
const releases: (() => void)[] = [];
afterEach(async () => {
	for (const release of releases.splice(0)) release();
	await held?.cleanup();
	held = undefined;
});

const gate = () => {
	let release = () => {};
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	releases.push(release);
	return { wait, release };
};
const twoTasks = (source: string) =>
	source
		.replace("  - { id: c, role: first, title: Task C }\n", "")
		.replace(
			"  - { id: d, role: second, title: Task D, context: [a, b] }\n",
			"",
		);
const fetchReply = (id: string) =>
	reply("", [
		{ name: "web_fetch", args: { url: `https://example.test/${id}` } },
	]);
const results = (h: SchedulerHarness, task: string) =>
	stateOf(h)?.context.team?.tasks[task]?.messages.filter(
		(m) => m.role === "tool",
	);

describe("scheduler effects and independent drains", () => {
	it.each([
		{
			name: "vault_write",
			args: { type: "journal", title: "Day", body: "Append" },
		},
		{ name: "browser_screenshot", args: { url: "https://example.test/" } },
		{ name: "seo_audit", args: { url: "https://example.test/" } },
	])(
		"rejects non-query $name even without a checkpoint flag",
		async (effect) => {
			const a = gatedReply("a");
			const b = gatedReply("b");
			releases.push(a.release, b.release);
			held = await schedulerHarness({
				scripts: [a.script, b.script],
				rewrite: (source) =>
					twoTasks(source).replaceAll(
						"capabilities: []",
						"capabilities: [vault.write@1, browser.screenshot@2, seo.audit@2]",
					),
			});
			await untilRequests(held, 2);
			const snapshot = stateOf(held);
			const context = snapshot && taskContext(snapshot.context, "a");
			if (!context) throw new Error("missing task context");
			expect(
				parallelTool(context, {
					kind: "tool",
					call: { id: "effect", ...effect },
					step: 0,
					checkpoint: false,
				}),
			).toBe(false);
		},
	);

	it("keeps a journal append exclusive although vault.write does not request a checkpoint", async () => {
		const a = gatedStream(
			reply("", [
				{
					name: "vault_write",
					args: { type: "journal", title: "Day", body: "Append this entry" },
				},
			]),
		);
		const b = gatedReply("b");
		releases.push(a.release, b.release);
		const append = gate();
		let appends = 0;
		held = await schedulerHarness({
			scripts: [a.script, b.script, reply("a")],
			rewrite: (source) =>
				twoTasks(source).replaceAll(
					"capabilities: []",
					"capabilities: [vault.write@1]",
				),
			tools: [
				[
					"vault.write@1",
					async () => {
						appends++;
						await append.wait;
						return ok({ path: "journal/day.md", created: false });
					},
				],
			],
		});
		const h = held;
		await untilRequests(h, 2);
		a.release();
		await vi.waitFor(() =>
			expect(stateOf(h)?.context.team?.tasks.a?.messages.at(-1)?.role).toBe(
				"assistant",
			),
		);
		expect(appends).toBe(0);
		b.release();
		await vi.waitFor(() => expect(appends).toBe(1));
		expect(h.requests).toHaveLength(2);
		expect(h.events.filter((e) => e.type === "checkpoint.created")).toEqual([]);
		append.release();
		await untilStatus(h, "completed");
		expect(appends).toBe(1);
		expect(results(h, "a")).toHaveLength(1);
	});

	it("settles successful peer B when paused A throws, reports A and never replays B on resume", async () => {
		const a = gate();
		const b = gate();
		const attempts = { a: 0, b: 0 };
		held = await schedulerHarness({
			scripts: [fetchReply("a"), fetchReply("b"), reply("done")],
			rewrite: (source) =>
				twoTasks(source).replaceAll(
					"capabilities: []",
					"capabilities: [web.fetch@1]",
				),
			tools: [
				[
					"web.fetch@1",
					async (input) => {
						const { url } = WebFetchInputSchema.parse(input);
						if (url.endsWith("/a")) {
							attempts.a++;
							if (attempts.a === 1) {
								await a.wait;
								throw new Error("Broken reader A");
							}
						} else {
							attempts.b++;
							await b.wait;
						}
						return ok({ markdown: url, title: "Page", finalUrl: url });
					},
				],
			],
		});
		const h = held;
		await vi.waitFor(() => expect(attempts).toEqual({ a: 1, b: 1 }));
		expect((await h.engine.pause(h.runId)).ok).toBe(true);
		a.release();
		b.release();
		await vi.waitFor(() => expect(results(h, "b")).toHaveLength(1));
		expect(stateOf(h)?.value).toBe("paused");
		expect(results(h, "a")).toEqual([]);
		expect(h.logged).toContainEqual({
			level: "error",
			msg: "scheduler call settlement threw",
		});
		expect((await h.engine.resume(h.runId)).ok).toBe(true);
		await untilStatus(h, "completed");
		expect(attempts).toEqual({ a: 2, b: 1 });
		expect(results(h, "b")).toHaveLength(1);
		expect(results(h, "b")?.[0]?.content).toContain("https://example.test/b");
	});
});
