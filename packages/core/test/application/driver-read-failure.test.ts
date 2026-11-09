import { setImmediate as tick } from "node:timers/promises";
import { type McpToolsAdapter, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RunSnapshot } from "../../src/domain/run-machine.js";
import type { RunStore } from "../../src/infrastructure/run-store.js";
import { engineHarness, reply, type Script, slow } from "../helpers/engine.js";
import { schedulerHarness } from "../helpers/scheduler.js";

const readFault = (afterSave?: (snapshot: RunSnapshot) => boolean) => {
	const state = { unreadable: false, failures: 0, writes: 0 };
	const wrapStore = (store: RunStore): RunStore => ({
		...store,
		load(id) {
			if (state.unreadable) {
				state.failures++;
				throw new Error("storage read unavailable");
			}
			return store.load(id);
		},
		save(meta, snapshot) {
			if (state.unreadable) state.writes++;
			store.save(meta, snapshot);
			if (afterSave?.(snapshot)) state.unreadable = true;
		},
	});
	return { state, wrapStore };
};

const start = async (h: ReturnType<typeof engineHarness>) => {
	const result = await h.engine.start({
		goal: "guard reads",
		templateId: null,
	});
	if (!result.ok) throw new Error(result.error.message);
	return result.value.runId;
};

describe("driver persistence read failures", () => {
	it("does not fetch parallel MCP metadata after reservation when TAINT persistence is refused", async () => {
		const fault = readFault(
			(snapshot) => (snapshot.context.reservations?.length ?? 0) > 0,
		);
		let listed = 0;
		const h = await schedulerHarness({
			scripts: [slow],
			wrapStore: fault.wrapStore,
			rewrite: (source) =>
				source.replaceAll("capabilities: []", "capabilities: [mcp.tools@1]"),
			configure: (engine) => {
				engine.registry.provide<McpToolsAdapter>("mcp.tools@1", {
					id: "fixture-mcp",
					trust: "core",
					features: [],
					impl: {
						list: async () => {
							listed++;
							return ok([]);
						},
						call: async () => ok({ content: [], isError: false }),
					},
				});
			},
		});
		try {
			await vi.waitFor(() => expect(fault.state.failures).toBeGreaterThan(0));
			await tick();
			expect(listed).toBe(0);
			expect(h.requests).toEqual([]);
			expect(fault.state.writes).toBe(0);
			fault.state.unreadable = false;
			const saved = h.store.load(h.runId)?.snapshot;
			expect(saved?.value).toBe("running");
			expect(saved?.context.reservations).toHaveLength(1);
			expect(
				Object.values(saved?.context.team?.tasks ?? {}).some(
					(task) => task.session?.tainted === true,
				),
			).toBe(false);
		} finally {
			fault.state.unreadable = false;
			await h.cleanup();
		}
	});

	for (const phase of ["MODEL", "REPLIED"] as const)
		it(`retires the driver after a refused ${phase} without another model request`, async () => {
			const fault = readFault();
			let modelSignal: AbortSignal | undefined;
			const script: Script = async function* (_request, signal) {
				modelSignal = signal;
				const chunks = reply("done");
				if (phase === "MODEL") fault.state.unreadable = true;
				yield* chunks.slice(0, 1);
				if (phase === "REPLIED") fault.state.unreadable = true;
				yield* chunks.slice(1);
			};
			const h = engineHarness({
				scripts: [script, slow],
				wrapStore: fault.wrapStore,
			});
			try {
				const runId = await start(h);
				await vi.waitFor(() => expect(fault.state.failures).toBeGreaterThan(0));
				await tick();
				expect(h.requests).toHaveLength(1);
				if (phase === "MODEL") expect(modelSignal?.aborted).toBe(true);
				expect(fault.state.writes).toBe(0);
				expect(
					h.events.filter((event) =>
						[
							"run.paused",
							"run.failed",
							"run.completed",
							"run.cancelled",
						].includes(event.type),
					),
				).toEqual([]);
				fault.state.unreadable = false;
				const saved = h.store.load(runId)?.snapshot;
				expect(saved?.value).toBe("running");
				expect(saved?.context.requests).toBe(0);
				expect(
					saved?.context.messages.some(
						(message) => message.role === "assistant",
					),
				).toBe(false);
			} finally {
				fault.state.unreadable = false;
				await h.stop();
				h.db.close();
			}
		});

	it("does not fetch MCP metadata or request a model when TAINT persistence is refused", async () => {
		const fault = readFault((snapshot) => snapshot.value === "running");
		let listed = 0;
		const h = engineHarness({ scripts: [slow], wrapStore: fault.wrapStore });
		h.registry.provide<McpToolsAdapter>("mcp.tools@1", {
			id: "fixture-mcp",
			trust: "core",
			features: [],
			impl: {
				list: async () => {
					listed++;
					return ok([]);
				},
				call: async () => ok({ content: [], isError: false }),
			},
		});
		try {
			const result = await h.conversation.start({
				goal: "guard metadata",
				capabilities: ["mcp.tools@1"],
			});
			if (!result.ok) throw new Error(result.error.message);
			await vi.waitFor(() => expect(fault.state.failures).toBeGreaterThan(0));
			await tick();
			expect(listed).toBe(0);
			expect(h.requests).toEqual([]);
			expect(fault.state.writes).toBe(0);
			fault.state.unreadable = false;
			const saved = h.store.load(result.value.runId)?.snapshot;
			expect(saved?.value).toBe("running");
			expect(saved?.context.tainted).not.toBe(true);
		} finally {
			fault.state.unreadable = false;
			await h.stop();
			h.db.close();
		}
	});

	for (const phase of ["CHECKPOINTED", "TOOL_STARTED"] as const)
		it(`does not dispatch a write when ${phase} persistence is refused`, async () => {
			const fault = readFault(
				(snapshot) =>
					phase === "TOOL_STARTED" &&
					snapshot.value === "running" &&
					snapshot.context.checkpointed >= 0,
			);
			let release = () => {};
			const pending = new Promise<void>((resolve) => {
				release = resolve;
			});
			let checkpoints = 0;
			let writes = 0;
			const h = engineHarness({
				scripts: [
					reply("", [
						{ name: "fs_write", args: { path: "a.txt", content: "a" } },
					]),
					slow,
				],
				wrapStore: fault.wrapStore,
				tools: [
					[
						"vcs.git@2",
						async () => {
							checkpoints++;
							if (phase === "CHECKPOINTED") fault.state.unreadable = true;
							return ok({
								op: "checkpoint.create",
								ref: "refs/mete/checkpoints/run/1",
								sha: "a".repeat(40),
							});
						},
					],
					[
						"fs.write@1",
						async () => {
							writes++;
							await pending;
							return ok({ bytes: 1 });
						},
					],
				],
			});
			try {
				const runId = await start(h);
				await vi.waitFor(() => expect(fault.state.failures).toBeGreaterThan(0));
				await tick();
				expect(checkpoints).toBe(1);
				expect(writes).toBe(0);
				expect(h.requests).toHaveLength(1);
				expect(fault.state.writes).toBe(0);
				expect(
					h.events.some(
						(event) =>
							event.type === "agent.tool.called" &&
							event.payload.capability === "fs.write@1",
					),
				).toBe(false);
				fault.state.unreadable = false;
				const saved = h.store.load(runId)?.snapshot;
				expect(saved?.value).toBe("running");
				expect(saved?.context.inFlight).toBeUndefined();
				if (phase === "CHECKPOINTED")
					expect(saved?.context.checkpointed).toBe(-1);
				else expect(saved?.context.checkpointed).toBeGreaterThanOrEqual(0);
			} finally {
				fault.state.unreadable = false;
				release();
				await h.stop();
				h.db.close();
			}
		});
});
