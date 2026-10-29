import { ok } from "@mete/contracts";
import { llmChatContract, llmEmbedContract } from "@mete/testing";
import { createLlmChat } from "../src/application/chat.js";
import { createLlmEmbed } from "../src/application/embed.js";
import {
	deps,
	done,
	fakeEmbedder,
	fakeProvider,
	fakeQuota,
	NOW,
	offer,
	text,
	vectors,
} from "./application/fakes.js";

// Runs the llm.chat@2 and llm.embed@1 kits against the gateway pipelines over fake providers and a
// fake pool.

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

llmEmbedContract("gateway", async (scenario) => {
	const e = fakeEmbedder("a", [ok(vectors(2))]);
	const q = fakeQuota();
	if (scenario === "quota-exhausted")
		q.failWith({
			code: "quota_exhausted",
			resumesAt: new Date(NOW + 60_000).toISOString(),
		});
	const offered = scenario === "no-model" ? [] : [offer(e.adapter, "m")];
	const { deps: d } = deps({ discover: async () => offered, quota: q.quota });
	return { adapter: createLlmEmbed(d), close: async () => {} };
});
