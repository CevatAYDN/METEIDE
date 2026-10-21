import type {
	CapabilityRef,
	LlmChatAdapter,
	LlmChatRequest,
} from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { describe, expect, it } from "vitest";
import { callModel, callTool } from "../../src/application/steps.js";
import {
	EXTERNAL_LABEL,
	type Seat,
	SINGLE_AGENT,
} from "../../src/domain/tools.js";
import { reply } from "../helpers/engine.js";

const setup = (refs: CapabilityRef[]) => {
	const registry = createCapabilityRegistry(() => []);
	const asked: LlmChatRequest[] = [];
	const llm: LlmChatAdapter = {
		chat: async function* (req) {
			asked.push(req);
			yield* reply("hi");
		},
	};
	const ran: string[] = [];
	const provide = (ref: CapabilityRef, impl: unknown) =>
		registry.provide(ref, { id: ref, trust: "core", features: [], impl });
	provide("llm.chat@1", llm);
	for (const ref of refs)
		provide(ref, {
			run: async () => {
				ran.push(ref);
				return { ok: true, value: {} };
			},
		});
	return { deps: { registry, now: () => 0 }, asked, ran };
};

const run = { runId: "r", priority: 1 as const, messages: [] };
const signal = new AbortController().signal;
const names = (req: LlmChatRequest | undefined) =>
	req?.tools?.map((t) => t.name);

const researcher: Seat = {
	tier: "reasoning",
	needs: [],
	capabilities: ["fs.*@1", "web.search@1"],
};

describe("steps for a seat", () => {
	it("asks the coder tier with every active tool for a single agent", async () => {
		const { deps, asked } = setup(["fs.read@1", "shell.exec@1"]);
		await callModel(deps, { ...run, seat: SINGLE_AGENT }, () => {}, signal);
		expect(asked[0]).toMatchObject({
			target: { tier: "coder" },
			needs: ["tool_calling"],
		});
		expect(names(asked[0])).toEqual(["fs_read", "shell_exec"]);
	});

	it("asks the role's tier and offers only its capabilities, fs.*@1 meaning every fs tool", async () => {
		const { deps, asked } = setup(["fs.read@1", "fs.write@1", "shell.exec@1"]);
		await callModel(deps, { ...run, seat: researcher }, () => {}, signal);
		expect(asked[0]?.target).toEqual({ tier: "reasoning" });
		expect(asked[0]?.needs).toBeUndefined();
		expect(names(asked[0])).toEqual(["fs_read", "fs_write"]);
	});

	it("leaves the web tools out for the single agent and labels a web result as data", async () => {
		const { deps, asked } = setup(["fs.read@1", "web.search@1"]);
		await callModel(deps, { ...run, seat: SINGLE_AGENT }, () => {}, signal);
		expect(names(asked[0])).toEqual(["fs_read"]);
		const seat: Seat = {
			tier: "fast",
			needs: [],
			capabilities: ["web.search@1"],
		};
		const call = { id: "c", name: "web_search", args: { query: "q" } };
		const out = await callTool(deps, { call, seat }, { signal }, () => {});
		expect(out.kind === "result" && out.external).toBe(true);
		const content = out.kind === "result" ? out.message.content : "";
		const [label, json] = content.split("\n");
		expect(label).toBe(EXTERNAL_LABEL);
		expect(JSON.parse(json ?? "")).toEqual({ ok: true, value: {} });
	});

	it("refuses a tool call outside the seat without running it", async () => {
		const { deps, ran } = setup(["shell.exec@1"]);
		const call = { id: "c", name: "shell_exec", args: { command: "ls" } };
		const out = await callTool(
			deps,
			{ call, seat: researcher },
			{ signal },
			() => {},
		);
		expect(ran).toEqual([]);
		expect(out.kind === "result" && JSON.parse(out.message.content)).toEqual({
			ok: false,
			error: { code: "bad_input", message: "unknown tool shell_exec" },
		});
	});
});
