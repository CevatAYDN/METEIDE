import { err, type McpToolsAdapter, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { loadSnapshot } from "../../src/infrastructure/run-store.js";
import { engineHarness, reply } from "../helpers/engine.js";

const completed = async (h: ReturnType<typeof engineHarness>, runId: string) =>
	vi.waitFor(() =>
		expect(h.engine.status(runId)).toMatchObject({
			ok: true,
			value: [{ status: "completed" }],
		}),
	);

describe("conversation.run@1", () => {
	it("offers only baseline tools by default and adds exactly the selected extras", async () => {
		const h = engineHarness({
			scripts: [reply("done")],
			tools: [
				["fs.read@1", async () => ok("read")],
				["web.search@1", async () => ok({ results: [] })],
				["web.fetch@1", async () => ok("page")],
			],
		});
		try {
			for (const capabilities of [[], ["web.search@1"]] as const) {
				const started = await h.conversation.start({
					goal: "hello",
					capabilities: [...capabilities],
				});
				if (!started.ok) throw new Error(started.error.message);
				await completed(h, started.value.runId);
			}
			expect(h.requests[0]?.tools?.map((t) => t.name)).toEqual(["fs_read"]);
			expect(h.requests[1]?.tools?.map((t) => t.name)).toEqual([
				"fs_read",
				"web_search",
			]);
			expect(
				await h.conversation.start({
					goal: "invalid",
					capabilities: ["web.search@1", "web.search@1"],
				}),
			).toMatchObject({ ok: false, error: { code: "bad_input" } });
			expect(h.requests).toHaveLength(2);
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("persists selection across restart, inherits on reply, and allows explicit removal", async () => {
		const first = engineHarness({ scripts: [reply("hello")] });
		const started = await first.conversation.start({
			goal: "hello",
			capabilities: ["web.fetch@1"],
		});
		if (!started.ok) throw new Error(started.error.message);
		await completed(first, started.value.runId);
		const original = first.store.load(started.value.runId);
		if (!original) throw new Error("snapshot");
		await first.stop();
		const h = engineHarness({ db: first.db, scripts: [reply("next")] });
		try {
			const next = await h.conversation.reply({
				runId: started.value.runId,
				message: "follow up",
			});
			if (!next.ok) throw new Error(next.error.message);
			await completed(h, next.value.runId);
			expect(
				h.store.load(next.value.runId)?.snapshot.context.extraCapabilities,
			).toEqual(["web.fetch@1"]);
			const cleared = await h.conversation.reply({
				runId: next.value.runId,
				message: "no extras",
				capabilities: [],
			});
			if (!cleared.ok) throw new Error(cleared.error.message);
			await completed(h, cleared.value.runId);
			expect(
				h.store.load(cleared.value.runId)?.snapshot.context.extraCapabilities,
			).toEqual([]);
			expect(h.store.load(started.value.runId)).toEqual(original);
			const { extraCapabilities: _selection, ...legacy } =
				original.snapshot.context;
			expect(
				loadSnapshot(
					JSON.stringify({
						value: "completed",
						context: legacy,
					}),
				).context.extraCapabilities,
			).toEqual([]);
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("keeps selected web calls under policy refusal", async () => {
		const refused = vi.fn(async () =>
			err({ code: "denied", message: "policy refused", rule: "net" }),
		);
		const h = engineHarness({
			scripts: [
				reply("", [{ name: "web_search", args: { query: "hello" } }]),
				reply("refused"),
			],
			tools: [["web.search@1", refused]],
		});
		try {
			const start = await h.conversation.start({
				goal: "search",
				capabilities: ["web.search@1"],
			});
			if (!start.ok) throw new Error(start.error.message);
			await completed(h, start.value.runId);
			expect(h.events).toContainEqual(
				expect.objectContaining({
					type: "agent.tool.completed",
					payload: expect.objectContaining({
						ok: false,
						error: { code: "denied" },
					}),
				}),
			);
			expect(h.requests[1]?.messages).toContainEqual(
				expect.objectContaining({
					role: "tool",
					content: expect.stringContaining('"code":"denied"'),
				}),
			);
		} finally {
			await h.stop();
			h.db.close();
		}
	});

	it("checkpoints raw MCP calls, records uncertain writes, and retains external taint", async () => {
		let runId = "";
		const call = vi.fn<McpToolsAdapter["call"]>(async () => {
			expect(h.store.load(runId)?.snapshot.context.inFlight).toBe(
				"call-0-mcp_demo_change",
			);
			return ok({
				content: [{ type: "text", text: "external" }],
				isError: false,
			});
		});
		const h = engineHarness({
			scripts: [
				reply("", [{ name: "mcp_demo_change", args: {} }]),
				reply("done"),
			],
			tools: [
				[
					"vcs.git@2",
					async () =>
						ok({ op: "checkpoint.create", ref: "checkpoint", sha: "sha" }),
				],
			],
		});
		h.registry.provide<McpToolsAdapter>("mcp.tools@1", {
			id: "raw",
			trust: "core",
			features: [],
			impl: {
				list: async () =>
					ok(
						["demo", "other"].map((server) => ({
							server,
							name: "change",
							description: "Change",
							inputSchema: { type: "object", properties: {} },
						})),
					),
				call,
			},
		});
		try {
			const start = await h.conversation.start({
				goal: "change",
				capabilities: ["mcp.tools@1"],
			});
			if (!start.ok) throw new Error(start.error.message);
			runId = start.value.runId;
			await completed(h, runId);
			expect(h.requests[0]?.tools?.map((t) => t.name)).toEqual([
				"vcs_git",
				"mcp_demo_change",
				"mcp_other_change",
			]);
			expect(call).toHaveBeenCalledOnce();
			expect(h.events.some((e) => e.type === "checkpoint.created")).toBe(true);
			expect(h.store.load(runId)?.snapshot.context.tainted).toBe(true);
		} finally {
			await h.stop();
			h.db.close();
		}
	});
});
