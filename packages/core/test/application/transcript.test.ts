import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";

describe("team.engine@2 transcript (ADR-125)", () => {
	it("masks a tool call's stored arguments when it reads an ended run", async () => {
		const h = engineHarness({
			scripts: [
				reply("Reading.", [
					{ name: "fs_read", args: { path: "sk-SECRET.md" } },
				]),
				reply("Done."),
			],
			tools: [
				[
					"fs.read@1",
					async () =>
						ok({ content: "notes", totalLines: 1, lineEnding: "none" }),
				],
			],
		});
		h.registry.provide("secrets.mask@1", {
			id: "security",
			trust: "core",
			features: [],
			impl: {
				mask: async (text: string) => ({
					text: text.replaceAll("sk-SECRET", "[SECRET:1]"),
					masked: 1,
				}),
			},
		});
		const started = await h.engine.start({ goal: "read the notes" });
		if (!started.ok) throw new Error(started.error.message);
		const { runId } = started.value;
		await vi.waitFor(() => {
			const r = h.engine.status(runId);
			expect(r.ok && r.value[0]?.status).toBe("completed");
		});
		const t = await h.engine.transcript?.(runId);
		expect(t?.ok && t.value.conversations[0]?.steps[0]).toEqual({
			text: "Reading.",
			toolCalls: [
				{
					name: "fs_read",
					args: '{"path":"[SECRET:1].md"}',
					result: {
						ok: true,
						text: '{"content":"notes","totalLines":1,"lineEnding":"none"}',
					},
				},
			],
		});
	});
});
