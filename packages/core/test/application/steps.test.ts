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

const setup = (refs: CapabilityRef[], answer = "hi") => {
	const registry = createCapabilityRegistry(() => []);
	const asked: LlmChatRequest[] = [];
	const llm: LlmChatAdapter = {
		chat: async function* (req) {
			asked.push(req);
			yield* reply(answer);
		},
	};
	const ran: string[] = [];
	const provide = (ref: CapabilityRef, impl: unknown) =>
		registry.provide(ref, { id: ref, trust: "core", features: [], impl });
	provide("llm.chat@2", llm);
	for (const ref of refs)
		provide(ref, {
			run: async () => {
				ran.push(ref);
				return { ok: true, value: {} };
			},
		});
	const warned: unknown[] = [];
	const logger = {
		error() {},
		warn: (fields: unknown) => warned.push(fields),
		info() {},
		debug() {},
	};
	return {
		deps: { registry, logger, now: () => 0, newId: () => "id" },
		asked,
		ran,
		warned,
	};
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

	it("reads tool calls the model wrote as text, with new ids (ADR-126)", async () => {
		const block =
			'<tool_call>{"name": "fs_read", "arguments": {"path": "a"}}</tool_call>';
		const { deps, warned } = setup(["fs.read@1"], block);
		const out = await callModel(
			deps,
			{ ...run, seat: SINGLE_AGENT },
			() => {},
			signal,
		);
		expect(out).toMatchObject({
			kind: "replied",
			message: {
				content: "",
				toolCalls: [{ id: "id", name: "fs_read", args: { path: "a" } }],
			},
		});
		expect(warned).toEqual([{ tools: ["fs_read"] }]);
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

	it("tries the next adapter after an io failure, but never for a write tool", async () => {
		const { deps } = setup([]);
		const io = { ok: false, error: { code: "io", message: "down" } };
		const adapter = (id: string, out: unknown, ref: CapabilityRef) =>
			deps.registry.provide(ref, {
				id,
				trust: "core",
				features: [],
				impl: { run: async () => out },
			});
		adapter("exa-mcp", io, "web.search@1");
		adapter("tavily", { ok: true, value: { results: [] } }, "web.search@1");
		adapter("first", io, "fs.write@1");
		adapter("second", { ok: true, value: { bytes: 1 } }, "fs.write@1");
		const seat: Seat = {
			tier: "fast",
			needs: [],
			capabilities: ["web.search@1", "fs.write@1"],
		};
		const tried = async (name: string, args: unknown) => {
			const adapters: string[] = [];
			await callTool(
				deps,
				{ call: { id: "c", name, args }, seat },
				{ signal },
				(e) => {
					if (e.type === "agent.tool.called")
						adapters.push(e.payload.adapterId);
				},
			);
			return adapters;
		};
		expect(await tried("web_search", { query: "q" })).toEqual([
			"exa-mcp",
			"tavily",
		]);
		expect(await tried("fs_write", { path: "a", content: "x" })).toEqual([
			"first",
		]);
	});

	it("tells the model a capability is missing when its optional module is not there", async () => {
		const { deps } = setup([]);
		const call = { id: "c", name: "shell_exec", args: { command: "ls" } };
		const out = await callTool(
			deps,
			{ call, seat: SINGLE_AGENT },
			{ signal },
			() => {},
		);
		expect(out.kind === "result" && JSON.parse(out.message.content)).toEqual({
			ok: false,
			error: {
				code: "capability_missing",
				message: "shell.exec@1 is not active",
			},
		});
	});

	it("refuses an fs write whose file could not be snapshotted, and never runs it (ADR-080)", async () => {
		const { deps, ran } = setup(["fs.write@1"]);
		const kept: string[] = [];
		const call = {
			id: "c",
			name: "fs_write",
			args: { path: "a.txt", content: "x" },
		};
		const out = await callTool(
			deps,
			{
				call,
				seat: SINGLE_AGENT,
				beforeWrite: async (path) => {
					kept.push(path);
					return { ok: false, error: { message: "disk full" } };
				},
			},
			{ signal },
			() => {},
		);
		expect(kept).toEqual(["a.txt"]);
		expect(ran).toEqual([]);
		expect(out.kind === "result" && JSON.parse(out.message.content)).toEqual({
			ok: false,
			error: {
				code: "io",
				message: "the file could not be snapshotted first: disk full",
			},
		});
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

describe("raw MCP tools", () => {
	const listed = [
		{
			server: "gh",
			name: "create_issue",
			description: "Open an issue.",
			inputSchema: { type: "object" },
		},
		{
			server: "gh",
			name: "bad",
			description: "",
			inputSchema: { type: "string" },
		},
		{
			server: "gh",
			name: "x".repeat(60),
			description: "",
			inputSchema: { type: "object" },
		},
	];
	const withMcp = (out: unknown) => {
		const s = setup([]);
		const calls: unknown[] = [];
		s.deps.registry.provide("mcp.tools@1", {
			id: "mcp-client",
			trust: "core",
			features: [],
			impl: {
				list: async () => ({ ok: true, value: listed }),
				call: async (input: unknown) => {
					calls.push(input);
					return out;
				},
			},
		});
		return { ...s, calls };
	};
	const seat: Seat = { tier: "fast", needs: [], capabilities: ["mcp.tools@1"] };
	const call = { id: "c", name: "mcp_gh_create_issue", args: { title: "t" } };

	it("offers each server tool as mcp_<server>_<tool> and leaves out the bad ones", async () => {
		const { deps, asked, warned } = withMcp(undefined);
		await callModel(deps, { ...run, seat }, () => {}, signal);
		expect(names(asked[0])).toEqual(["mcp_gh_create_issue"]);
		expect(asked[0]?.tools?.[0]?.description).toBe(
			"gh MCP server: Open an issue.",
		);
		expect(warned).toHaveLength(2);
	});

	it("calls the server's tool and labels its result as external", async () => {
		const done = { ok: true, value: { content: [], isError: false } };
		const { deps, calls } = withMcp(done);
		const events: string[] = [];
		const out = await callTool(deps, { call, seat }, { signal }, (e) =>
			events.push(e.type),
		);
		expect(calls).toEqual([
			{ server: "gh", tool: "create_issue", args: { title: "t" } },
		]);
		expect(out.kind === "result" && out.external).toBe(true);
		const content = out.kind === "result" ? out.message.content : "";
		expect(content.split("\n")[0]).toBe(EXTERNAL_LABEL);
		expect(events).toEqual(["agent.tool.called", "agent.tool.completed"]);
	});

	it("pauses when the policy asks, and hides the tools from a seat without mcp.tools@1", async () => {
		const ask = {
			ok: false,
			error: { code: "approval_required", rule: "mcp.call", message: "ask" },
		};
		const { deps, asked, calls } = withMcp(ask);
		expect(await callTool(deps, { call, seat }, { signal }, () => {})).toEqual({
			kind: "approval",
			rule: "mcp.call",
		});
		await callModel(deps, { ...run, seat: researcher }, () => {}, signal);
		expect(names(asked[0])).toBeUndefined();
		const out = await callTool(
			deps,
			{ call, seat: researcher },
			{ signal },
			() => {},
		);
		expect(
			out.kind === "result" && JSON.parse(out.message.content).error.code,
		).toBe("bad_input");
		expect(calls).toHaveLength(1);
	});
});
