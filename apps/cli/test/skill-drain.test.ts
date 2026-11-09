import {
	type ChatRequest,
	type FsReadInput,
	type FsReadOutput,
	ok,
	type RunQuiesceAdapter,
	type TeamEngineV3Adapter,
	type ToolAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/infrastructure/app.js";
import { scriptedProvider } from "./helpers.js";
import { skillAppFixture, skillText } from "./skill-app-fixture.js";

let fixture: Awaited<ReturnType<typeof skillAppFixture>> | undefined;
let releaseRead: (() => void) | undefined;
afterEach(async () => {
	releaseRead?.();
	releaseRead = undefined;
	await fixture?.close();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

const pausedNativeRead = async (app: App) => {
	const read =
		app.registry.resolve<ToolAdapter<FsReadInput, FsReadOutput>>("fs.read@1");
	const engine = app.registry.resolve<TeamEngineV3Adapter>("team.engine@3");
	const gate = app.registry.resolve<RunQuiesceAdapter>("run.quiesce@1");
	if (!read.ok || !engine.ok || !gate.ok)
		throw new Error("native ports missing");
	const original = read.value[0].impl.run.bind(read.value[0].impl);
	const waiting = new Promise<void>((resolve) => {
		releaseRead = resolve;
	});
	let entered = () => {};
	const inFlight = new Promise<void>((resolve) => {
		entered = resolve;
	});
	vi.spyOn(read.value[0].impl, "run").mockImplementation(async (input, ctx) => {
		if (input.path === "readme.txt") {
			entered();
			await waiting;
		}
		return original(input, ctx);
	});
	const started = await engine.value[0].impl.start({
		goal: "Read the fixture",
		templateId: null,
	});
	if (!started.ok) throw new Error("native run failed to start");
	await inFlight;
	expect(await engine.value[0].impl.pause(started.value.runId)).toEqual(
		ok(undefined),
	);
	const prepare = vi.spyOn(gate.value[0].impl, "prepare");
	return {
		engine: engine.value[0],
		gate: gate.value[0],
		prepare,
		runId: started.value.runId,
	};
};

describe("native skill mutation drain", () => {
	it.each(["expired", "aborted", "gate", "engine"] as const)(
		"reports admitted %s after drain without granting the reviewed version",
		async (code) => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-11-08T12:00:00.000Z"));
			fixture = await skillAppFixture();
			const t = fixture;
			await t.write("workspace", "public", skillText("public"));
			const seen: ChatRequest[] = [];
			const app = await t.start({
				provider: scriptedProvider({
					seen,
					script: [
						[
							{
								type: "tool-call",
								id: "pending-read",
								name: "fs_read",
								args: { path: "readme.txt" },
							},
							{
								type: "finish",
								reason: "tool-calls",
								usage: { prompt: 1, completion: 1 },
							},
						],
					],
				}),
			});
			await t.lock();
			const trust = t.trust(app);
			const listed = await trust.status(new AbortController().signal);
			if (!listed.ok) throw new Error("inventory failed");
			const sourceId = listed.value.entries[0]?.source.sourceId ?? "";
			const prepared = await trust.prepare(
				{ sourceId },
				new AbortController().signal,
			);
			if (!prepared.ok) throw new Error("preview failed");
			const native = await pausedNativeRead(app);
			const engine = native.engine.impl;
			const controller = new AbortController();
			let settled = false;
			const pending = trust
				.approve({ previewId: prepared.value.previewId }, controller.signal)
				.then((result) => {
					settled = true;
					return result;
				});
			await vi.waitFor(() => expect(native.prepare).toHaveBeenCalledOnce());
			expect(settled).toBe(false);
			expect(engine.status(native.runId)).toMatchObject({
				value: [{ status: "paused", pauseReason: "user" }],
			});
			const interference = {
				expired: () => vi.setSystemTime(new Date(prepared.value.expiresAt)),
				aborted: () => controller.abort(),
				gate: () =>
					Object.defineProperty(native.gate, "impl", {
						value: { prepare: async () => ok(null) },
					}),
				engine: () =>
					Object.defineProperty(native.engine, "impl", { value: {} }),
			};
			interference[code]();
			const expected = {
				expired: "expired",
				aborted: "aborted",
				gate: "unavailable",
				engine: "unavailable",
			};
			releaseRead?.();
			expect(await pending).toMatchObject({
				admitted: true,
				result: {
					ok: false,
					error: {
						code: expected[code],
					},
				},
			});
			const after = await trust.status(new AbortController().signal);
			expect(after).toMatchObject({
				ok: true,
				value: { entries: [{ status: "unapproved", revision: 0 }] },
			});
			expect(engine.status(native.runId)).toMatchObject({
				value: [{ status: "paused", pauseReason: "user" }],
			});
			expect(seen).toHaveLength(1);
			expect(t.fetch).not.toHaveBeenCalled();
		},
	);
});
