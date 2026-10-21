import { llmChatContract } from "@mete/testing";
import { createLlmChat } from "../src/application/chat.js";
import {
	deps,
	done,
	fakeProvider,
	fakeQuota,
	NOW,
	offer,
	text,
} from "./application/fakes.js";

// Runs the llm.chat@1 kit against the gateway pipeline over fake providers and a fake pool.

llmChatContract("gateway", async (scenario) => {
	const a = fakeProvider("a", [[text("hi"), done]]);
	const q = fakeQuota();
	if (scenario === "quota-exhausted")
		q.failWith({
			code: "quota_exhausted",
			resumesAt: new Date(NOW + 60_000).toISOString(),
		});
	const offered = scenario === "no-model" ? [] : [offer(a.adapter, "m")];
	const { deps: d } = deps({ discover: async () => offered, quota: q.quota });
	return {
		adapter: createLlmChat(d),
		target: { tier: "coder" },
		close: async () => {},
	};
});
