import type { ChatChunk, LlmChatRequest } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createLlmChat } from "../../src/application/chat.js";
import {
	collect,
	deps,
	done,
	fakeProvider,
	fakeQuota,
	offer,
	RUN,
	status,
	text,
} from "./fakes.js";

// How a model chain ends (docs/09, Chain end; ADR-064): a model the provider answers 404 for is left
// out like a refused key, and a chain that ran out after a passing failure ends with network.

const req: LlmChatRequest = {
	target: { tier: "coder" },
	runId: RUN,
	priority: 1,
	messages: [{ role: "user", content: "hello" }],
	maxTokens: 10,
};
const signal = () => new AbortController().signal;
const network: ChatChunk = {
	type: "error",
	error: { code: "network", message: "the model sent nothing for 120 s" },
};
const chain = (...providers: ReturnType<typeof fakeProvider>[]) =>
	deps({
		discover: async () =>
			providers.map((p, i) => offer(p.adapter, `m${i}`, 100_000 - i)),
		quota: fakeQuota().quota,
	}).deps;

describe("the end of a model chain (ADR-064)", () => {
	it("does not count models the provider answers 404 for, and leaves them out", async () => {
		const gone = ["g1", "g2", "g3", "g4", "g5"].map((id) =>
			fakeProvider(id, [[status(404)]]),
		);
		const b = fakeProvider("b", [[text("b"), done]]);
		const llm = createLlmChat(chain(...gone, b));
		const out = await collect(llm.chat(req, signal()));
		expect(out.at(-1)).toMatchObject({ type: "finish" });
		// A later call does not ask them again.
		await collect(llm.chat(req, signal()));
		expect(gone.map((g) => g.seen.length)).toEqual([1, 1, 1, 1, 1]);
	});

	it("ends with network when a model failed for a passing reason, whatever the last error", async () => {
		const quiet = ["q1", "q2", "q3"].map((id) => fakeProvider(id, [[network]]));
		const refusing = fakeProvider("r", [[status(400)]]);
		const out = await collect(
			createLlmChat(chain(...quiet, refusing)).chat(req, signal()),
		);
		expect(out.at(-1)).toMatchObject({
			type: "error",
			error: { code: "network" },
		});
	});

	it("keeps the last error when every model refused the request itself", async () => {
		const refusing = ["f1", "f2", "f3", "f4"].map((id) =>
			fakeProvider(id, [[status(400)]]),
		);
		const out = await collect(
			createLlmChat(chain(...refusing)).chat(req, signal()),
		);
		expect(out.at(-1)).toMatchObject({
			type: "error",
			error: { code: "bad_request" },
		});
	});
});
