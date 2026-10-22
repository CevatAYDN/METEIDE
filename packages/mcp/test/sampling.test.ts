import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
	LlmChatAdapter,
	LlmChatRequest,
	LlmChunk,
	McpToolsAdapter,
	ToolContext,
} from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { samplingRefusal, tierOf } from "../src/domain/sampling.js";
import { createMcpClientModule, type McpClientOptions } from "../src/module.js";
import { moduleContext } from "./helpers/context.js";

const FIXTURE = fileURLToPath(
	new URL("./fixtures/server.mjs", import.meta.url),
);
const fixture = {
	id: "fixture",
	transport: "stdio",
	runtime: "node",
	command: process.execPath,
	args: [FIXTURE],
};

// A scripted gateway: it answers "hello" as model fake/m1 and keeps what it was asked.
const scripted = (wait?: Promise<void>) => {
	const asked: LlmChatRequest[] = [];
	const seen = { aborted: false };
	const chat: LlmChatAdapter = {
		async *chat(req, signal) {
			asked.push(req);
			signal.addEventListener("abort", () => {
				seen.aborted = true;
			});
			await wait;
			yield {
				type: "model",
				providerId: "fake",
				modelId: "m1",
				reason: "first",
			} satisfies LlmChunk;
			yield { type: "text", text: "hello" };
			yield {
				type: "finish",
				reason: "stop",
				usage: { prompt: 1, completion: 1 },
			};
		},
	};
	return { chat, asked, seen };
};

const start = async (
	more: Partial<McpClientOptions>,
	chat?: LlmChatAdapter,
	verdict: (action: string) => "allow" | "ask" | "deny" = () => "allow",
) => {
	const module = createMcpClientModule({
		workspaceDir: tmpdir(),
		builtInServers: [],
		...more,
	});
	const { ctx, registry } = moduleContext(
		verdict,
		{ mcp: { servers: [fixture] } },
		chat,
	);
	await module.activate(ctx);
	const r = registry.resolve<McpToolsAdapter>("mcp.tools@1");
	const tools = r.ok ? r.value[0].impl : undefined;
	const summon = (ctx: ToolContext) =>
		tools?.call({ server: "fixture", tool: "summon" }, ctx);
	return { module, summon };
};

const textOf = (
	r: Awaited<ReturnType<Awaited<ReturnType<typeof start>>["summon"]>>,
) => {
	const block = r?.ok ? r.value.content[0] : undefined;
	return block?.type === "text" ? block.text : "";
};

const run = { signal: new AbortController().signal, runId: "run-1" };
const askUser = (answers: boolean[]) => {
	const questions: string[] = [];
	const confirm = async (server: string, question: string) => {
		questions.push(`${server}: ${question}`);
		return answers.shift() ?? false;
	};
	return { confirm, questions };
};
const askedOnly = (action: string) =>
	action === "mcp.sampling" ? "ask" : "allow";

describe("mcp-client sampling", () => {
	it("asks the user once per server, then answers through llm.chat@1 on the run's budget", async () => {
		const gateway = scripted();
		const user = askUser([true]);
		const s = await start({ confirm: user.confirm }, gateway.chat, askedOnly);
		expect(textOf(await s.summon(run))).toBe("fake/m1: hello");
		expect(textOf(await s.summon(run))).toBe("fake/m1: hello");
		expect(user.questions).toHaveLength(1);
		expect(user.questions[0]).toMatch(/^fixture: .*run's budget/);
		expect(gateway.asked).toHaveLength(2);
		expect(gateway.asked[0]).toEqual({
			target: { tier: "reasoning" },
			runId: "run-1",
			priority: 1,
			maxTokens: 20,
			messages: [
				{ role: "system", content: "Be brief" },
				{ role: "user", content: "Say hi" },
			],
		});
		await s.module.deactivate();
	});

	it("refuses when the user says no, and asks again at the server's next request", async () => {
		const gateway = scripted();
		const user = askUser([false, true]);
		const s = await start({ confirm: user.confirm }, gateway.chat, askedOnly);
		expect(textOf(await s.summon(run))).toMatch(/declined/);
		expect(gateway.asked).toEqual([]);
		expect(textOf(await s.summon(run))).toBe("fake/m1: hello");
		expect(user.questions).toHaveLength(2);
		await s.module.deactivate();
	});

	it("skips the question when the policy allows it, and refuses what it denies", async () => {
		const gateway = scripted();
		const user = askUser([]);
		const s = await start({ confirm: user.confirm }, gateway.chat);
		expect(textOf(await s.summon(run))).toBe("fake/m1: hello");
		expect(user.questions).toEqual([]);
		await s.module.deactivate();
		const denied = await start({ confirm: user.confirm }, gateway.chat, (a) =>
			a === "mcp.sampling" ? "deny" : "allow",
		);
		expect(textOf(await denied.summon(run))).toMatch(/denied/);
		await denied.module.deactivate();
	});

	it("needs a run to charge, a model to ask and a host to confirm", async () => {
		const gateway = scripted();
		const user = askUser([true]);
		const s = await start({ confirm: user.confirm }, gateway.chat);
		expect(textOf(await s.summon({ signal: run.signal }))).toMatch(/run/);
		await s.module.deactivate();
		const noModel = await start({ confirm: user.confirm });
		expect(textOf(await noModel.summon(run))).toMatch(/llm\.chat@1/);
		await noModel.module.deactivate();
		const noHost = await start({}, gateway.chat);
		// The client does not offer sampling, so the server's request finds no method to call.
		expect(textOf(await noHost.summon(run))).toMatch(/method not found/i);
		await noHost.module.deactivate();
	});

	it("stops the model call when the run's signal aborts", async () => {
		let release = () => {};
		const gateway = scripted(new Promise<void>((r) => (release = r)));
		const s = await start({ confirm: async () => true }, gateway.chat);
		const stop = new AbortController();
		const call = s.summon({ signal: stop.signal, runId: "run-1" });
		// A server process must start first, which is slow when many test files start one together.
		await vi.waitFor(() => expect(gateway.asked).toHaveLength(1), {
			timeout: 5000,
		});
		stop.abort();
		await call;
		await vi.waitFor(() => expect(gateway.seen.aborted).toBe(true), {
			timeout: 5000,
		});
		release();
		await s.module.deactivate();
	});
});

describe("sampling requests", () => {
	it("picks the tier by priority and refuses what METE cannot answer", () => {
		expect(tierOf({ intelligencePriority: 0.9 })).toBe("reasoning");
		expect(tierOf({ speedPriority: 0.9, intelligencePriority: 0.3 })).toBe(
			"fast",
		);
		expect(tierOf({ costPriority: 1 })).toBe("coder");
		expect(tierOf(undefined)).toBe("coder");
		const text = { type: "text", text: "hi" } as const;
		const ask = (content: unknown, more = {}) =>
			samplingRefusal({
				messages: [{ role: "user", content }],
				maxTokens: 5,
				...more,
			} as never);
		expect(ask(text)).toBeUndefined();
		expect(ask([text, text])).toBeUndefined();
		expect(ask({ type: "image", data: "x", mimeType: "image/png" })).toMatch(
			/text/,
		);
		expect(ask(text, { tools: [{ name: "t" }] })).toMatch(/tools/);
	});
});
