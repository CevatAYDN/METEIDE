import type { ChatChunk, LlmChatRequest } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createLlmChat } from "../../src/application/chat.js";
import { watched } from "../../src/application/stall.js";
import {
	collect,
	deps,
	done,
	fakeProvider,
	fakeQuota,
	text as gwText,
	offer,
	RUN,
} from "./fakes.js";

// A provider stream that goes quiet ends with a network error and is aborted (docs/09, ADR-062).

const LIMITS = { firstMs: 60, gapMs: 40 };
const text = (t: string): ChatChunk => ({ type: "text", text: t });
const finish: ChatChunk = {
	type: "finish",
	reason: "stop",
	usage: { prompt: 1, completion: 1 },
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A stream that sends `script` (a number waits that many ms) and then hangs until aborted.
const stream =
	(script: (ChatChunk | number)[], hang = false) =>
	(signal: AbortSignal) =>
		(async function* () {
			for (const step of script) {
				if (typeof step === "number") await pause(step);
				else yield step;
			}
			if (hang) await new Promise((r) => signal.addEventListener("abort", r));
		})();

const all = async (s: AsyncIterable<ChatChunk>) => {
	const out: ChatChunk[] = [];
	for await (const c of s) out.push(c);
	return out;
};

describe("a quiet provider stream (ADR-062)", () => {
	it("passes a stream that keeps talking", async () => {
		const out = await all(
			watched(
				stream([text("a"), 20, text("b"), 20, finish]),
				new AbortController().signal,
				LIMITS,
			),
		);
		expect(out).toEqual([text("a"), text("b"), finish]);
	});

	it("ends a stream that never starts, and aborts it", async () => {
		let aborted = false;
		const open = (signal: AbortSignal) => {
			signal.addEventListener("abort", () => {
				aborted = true;
			});
			return stream([], true)(signal);
		};
		const out = await all(watched(open, new AbortController().signal, LIMITS));
		expect(out).toEqual([
			{
				type: "error",
				error: {
					code: "network",
					message: "the model sent nothing for 0.06 s",
				},
			},
		]);
		expect(aborted).toBe(true);
	});

	it("ends a stream that goes quiet between chunks", async () => {
		const out = await all(
			watched(stream([text("a")], true), new AbortController().signal, LIMITS),
		);
		expect(out).toEqual([
			text("a"),
			{
				type: "error",
				error: {
					code: "network",
					message: "the model sent nothing for 0.04 s",
				},
			},
		]);
	});
});

describe("a quiet model in the chain (ADR-062)", () => {
	it("moves to the next model when the first sends nothing", async () => {
		const hang = fakeProvider("quiet", [[]]);
		hang.adapter.chat = async function* (_req, signal) {
			await new Promise((r) => signal.addEventListener("abort", r));
		};
		const b = fakeProvider("b", [[gwText("from b"), done]]);
		const q = fakeQuota();
		const { deps: d, calls } = deps({
			discover: async () => [offer(hang.adapter, "m1"), offer(b.adapter, "m2")],
			quota: q.quota,
			stall: LIMITS,
		});
		const req: LlmChatRequest = {
			target: { tier: "coder" },
			runId: RUN,
			priority: 1,
			messages: [{ role: "user", content: "hello" }],
			maxTokens: 10,
		};
		const out = await collect(
			createLlmChat(d).chat(req, new AbortController().signal),
		);
		expect(out.filter((c) => c.type === "text")).toEqual([gwText("from b")]);
		expect(calls.map((c) => [c.providerId, c.outcome])).toEqual([
			["quiet", "network"],
			["b", "stop"],
		]);
	});
});
