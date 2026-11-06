import { parseTemplate } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { runMachine } from "../../src/domain/run-machine.js";
import { teamOf } from "../../src/domain/team.js";
import { engineHarness, reply, type Tool } from "../helpers/engine.js";

const completed = async (h: ReturnType<typeof engineHarness>, runId: string) =>
	vi.waitFor(() =>
		expect(h.engine.status(runId)).toMatchObject({
			ok: true,
			value: [{ status: "completed" }],
		}),
	);

describe("run.reply@1", () => {
	it("keeps history and model choice in a new run without reopening the original", async () => {
		const h = engineHarness({ scripts: [reply("Merhaba"), reply("Iyiyim")] });
		const first = await h.engine.start({
			goal: "selam",
			templateId: null,
			prefer: { providerId: "p", modelId: "m1" },
		});
		if (!first.ok) throw new Error("start");
		await completed(h, first.value.runId);
		const original = h.store.load(first.value.runId);
		const next = await h.reply.reply({
			runId: first.value.runId,
			message: "  nasilsin?  ",
		});
		if (!next.ok) throw new Error(next.error.message);
		expect(next.value.runId).not.toBe(first.value.runId);
		await completed(h, next.value.runId);
		expect(h.requests[1]?.messages).toEqual([
			...(original?.snapshot.context.messages ?? []),
			{ role: "user", content: "nasilsin?" },
		]);
		expect(h.store.load(first.value.runId)).toEqual(original);
		expect(h.store.load(next.value.runId)?.snapshot.context).toMatchObject({
			requests: 1,
			turns: 1,
			prefer: { providerId: "p", modelId: "m1" },
		});
		expect(h.store.load(next.value.runId)?.snapshot.context.agent?.id).not.toBe(
			original?.snapshot.context.agent?.id,
		);
		await h.stop();
		h.db.close();
	});

	it("works after restart and carries external-content taint into follow-up tools", async () => {
		const first = engineHarness({
			scripts: [
				reply("", [{ name: "fs_read", args: { path: "a" } }]),
				reply("Read"),
			],
			tools: [["fs.read@1", async () => ({ ok: true, value: "data" })]],
		});
		const start = await first.engine.start({ goal: "read", templateId: null });
		if (!start.ok) throw new Error("start");
		await completed(first, start.value.runId);
		const row = first.store.load(start.value.runId);
		if (!row) throw new Error("row");
		first.store.save(row.meta, {
			...row.snapshot,
			context: { ...row.snapshot.context, tainted: true },
		});
		await first.stop();
		const tool = vi.fn<Tool>(async () => ({
			ok: true as const,
			value: "done",
		}));
		const h = engineHarness({
			db: first.db,
			scripts: [
				reply("", [{ name: "fs_read", args: { path: "b" } }]),
				reply("done"),
			],
			tools: [["fs.read@1", tool]],
		});
		const next = await h.reply.reply({
			runId: start.value.runId,
			message: "and b?",
		});
		if (!next.ok) throw new Error(next.error.message);
		await completed(h, next.value.runId);
		expect(tool.mock.calls[0]?.[1]).toMatchObject({
			tainted: true,
			runId: next.value.runId,
		});
		await h.stop();
		h.db.close();
	});

	it("refuses invalid messages, missing and unfinished runs without calling a model", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		expect(
			await h.reply.reply({ runId: "missing", message: " " }),
		).toMatchObject({ ok: false, error: { code: "bad_input" } });
		expect(
			await h.reply.reply({ runId: "missing", message: "hi" }),
		).toMatchObject({ ok: false, error: { code: "not_found" } });
		expect(h.requests).toHaveLength(0);
		await h.stop();
		h.db.close();
	});

	it("refuses every non-completed state and completed teams without starting more requests", async () => {
		const h = engineHarness({ scripts: [reply("done")] });
		const started = await h.engine.start({ goal: "hello", templateId: null });
		if (!started.ok) throw new Error("start");
		await completed(h, started.value.runId);
		await h.stop();
		const row = h.store.load(started.value.runId);
		if (!row) throw new Error("row");
		for (const value of [
			"queued",
			"running",
			"paused",
			"failed",
			"cancelled",
		] as const) {
			h.store.save(
				{ ...row.meta, id: value },
				runMachine.resolveState({ value, context: row.snapshot.context }),
			);
			expect(
				await h.reply.reply({ runId: value, message: "next" }),
			).toMatchObject({
				ok: false,
				error: { code: "invalid_state", status: value },
			});
		}
		const template = parseTemplate({
			apiVersion: "mete/v1",
			kind: "TeamTemplate",
			metadata: { id: "solo", name: "Solo", version: "1.0.0" },
			pattern: "single",
			roles: [
				{
					id: "reader",
					name: "Reader",
					goal: "Read",
					tier: "fast",
					capabilities: [],
				},
			],
			tasks: [{ id: "task", role: "reader", title: "Read" }],
		});
		if (!template.ok) throw new Error("template");
		h.store.save(
			{ ...row.meta, id: "team" },
			runMachine.resolveState({
				value: "completed",
				context: { ...row.snapshot.context, team: teamOf(template.value) },
			}),
		);
		expect(
			await h.reply.reply({ runId: "team", message: "next" }),
		).toMatchObject({ ok: false, error: { code: "not_supported" } });
		expect(h.requests).toHaveLength(1);
		h.db.close();
	});
});
