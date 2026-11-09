import type { CapabilityRef, ToolContext } from "@mete/contracts";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServerModule } from "../src/server-module.js";
import { moduleContext } from "./helpers/context.js";

const fields = (t: string) => ({ title: t, heading: t, snippet: t });
const HIT = {
	path: "lessons/search.md",
	scope: "workspace",
	type: "lesson",
	...fields("secret"),
	sources: { keyword: 1 },
};
const VALUE = { results: [HIT] };
const OK = { ok: true, value: VALUE };
const REFUSED = {
	ok: false,
	error: { code: "denied", message: "secret", rule: "test" },
};
const EMPTY = { ok: true, value: { results: [] } };
const IO = [{ type: "text", text: "io: knowledge search failed" }];
const throwSecret = () => Promise.reject(new Error("secret"));
const mask = async (text: string) => ({
	text: text.replaceAll("secret", "[SECRET:12345678]"),
	masked: 1,
});
const serve = async () => {
	const [mine, theirs] = InMemoryTransport.createLinkedPair();
	const { ctx, registry } = moduleContext("allow");
	const history = () => undefined;
	const module = createMcpServerModule({ transport: mine, history });
	const provide = (ref: CapabilityRef, impl: unknown) =>
		registry.provide(ref, { id: ref, trust: "core", features: [], impl });
	const masking = provide("secrets.mask@1", { mask });
	const replies = vi.spyOn(mine, "send");
	await module.activate(ctx);
	const client = new Client({ name: "knowledge-test", version: "0" });
	await client.connect(theirs);
	const call = (query = "query", signal?: AbortSignal) =>
		client.callTool(
			{ name: "mete_knowledge_search", arguments: { query } },
			signal ? { signal } : undefined,
		);
	return { module, client, provide, masking, replies, call };
};
describe("MCP workspace knowledge", () => {
	let s: Awaited<ReturnType<typeof serve>>;
	afterEach(async () => {
		await s?.client.close();
		await s?.module.deactivate();
	});
	it("resolves each call with trimmed workspace defaults and masked answers", async () => {
		s = await serve();
		const run = vi.fn(async () => OK);
		const adapter = s.provide("knowledge.search@1", { run });
		const result = await s.call("  query  ");
		const value = { results: [{ ...HIT, ...fields("[SECRET:12345678]") }] };
		expect(result.structuredContent).toEqual(value);
		expect(result.content).toEqual([
			{ type: "text", text: JSON.stringify(value) },
		]);
		expect(result.isError).toBeFalsy();
		expect(run.mock.calls[0]).toEqual([
			{ query: "query", scope: "workspace", k: 8 },
			{ signal: expect.any(AbortSignal) },
		]);
		adapter.dispose();
		const replacement = vi.fn(async () => EMPTY);
		const next = s.provide("knowledge.search@1", { run: replacement });
		expect((await s.call("second")).structuredContent).toEqual({ results: [] });
		expect(replacement).toHaveBeenCalledWith(
			{ query: "second", scope: "workspace", k: 8 },
			{ signal: expect.any(AbortSignal) },
		);
		next.dispose();
		expect(JSON.stringify(await s.call())).toContain("not_supported");
	});
	it.each(["", " \t\n "])("refuses blank input %j", async (query) => {
		s = await serve();
		const run = vi.fn(async () => OK);
		s.provide("knowledge.search@1", { run });
		expect((await s.call(query)).isError).toBe(true);
		expect(run).not.toHaveBeenCalled();
	});
	it.each([
		null,
		{ ok: true },
		{ ok: "true", value: VALUE },
		throwSecret,
		{ ok: false, error: { message: "secret" } },
		{ ok: false, error: { code: "secret", message: "secret" } },
		{ ok: false, error: { code: "denied", message: "secret" } },
		{ ok: false, error: { code: "match_count", message: "secret" } },
		{
			ok: false,
			error: { code: "match_count", message: "secret", count: "2" },
		},
		{ ok: true, value: { results: [{ ...HIT, scope: "personal" }] } },
		{ ok: true, value: { results: [{ ...HIT, sources: { keyword: 0 } }] } },
		{ ok: true, value: { results: [], secret: "secret" } },
		{ ok: true, value: { results: Array(9).fill(HIT) } },
	])("refuses malformed, thrown or non-workspace output %j", async (output) => {
		s = await serve();
		const run = typeof output === "function" ? output : async () => output;
		s.provide("knowledge.search@1", { run });
		const result = await s.call();
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toBeUndefined();
		expect(result.content).toEqual(IO);
	});
	it("requires masking and preserves a valid denied code with its masked message", async () => {
		s = await serve();
		const run = vi.fn(async () => REFUSED);
		s.provide("knowledge.search@1", { run });
		s.masking.dispose();
		expect(JSON.stringify(await s.call())).toContain("not_supported");
		expect(run).not.toHaveBeenCalled();
		s.provide("secrets.mask@1", { mask });
		const result = await s.call("!!!");
		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{ type: "text", text: "denied: [SECRET:12345678]" },
		]);
	});
	it.each([
		throwSecret,
		async () => ({ text: "secret" }),
		async () => ({ text: "secret", masked: -1 }),
	])("fails closed on failed or invalid masking", async (failedMask) => {
		s = await serve();
		let output: unknown = OK;
		s.provide("knowledge.search@1", { run: async () => output });
		s.masking.dispose();
		s.provide("secrets.mask@1", { mask: failedMask });
		const result = await s.call();
		expect(result.isError).toBe(true);
		expect(result.content).toEqual(IO);
		output = REFUSED;
		expect((await s.call()).content).toEqual(IO);
	});
	it.each([
		{ from: "workspace", to: "personal" },
		{ from: "secret", to: "" },
	])("rejects invalid rebuilt masked output %j", async ({ from, to }) => {
		s = await serve();
		s.provide("knowledge.search@1", { run: async () => OK });
		s.masking.dispose();
		s.provide("secrets.mask@1", {
			mask: async (text: string) => ({
				text: text === from ? to : text,
				masked: 1,
			}),
		});
		expect((await s.call()).content).toEqual(IO);
	});
	it("masks unescaped string values and fails on optional-field masking errors", async () => {
		s = await serve();
		const secret = 'secret\r\n"\\value';
		const value = { results: [{ ...HIT, heading: secret }] };
		let failOptional = false;
		const exactMask = vi.fn(async (text: string) => ({
			text: failOptional && text === secret ? undefined : "[SECRET:12345678]",
			masked: 1,
		}));
		s.provide("knowledge.search@1", { run: async () => ({ ok: true, value }) });
		s.masking.dispose();
		s.provide("secrets.mask@1", {
			mask: async (text: string) =>
				text === "secret" || text === secret
					? exactMask(text)
					: { text, masked: 0 },
		});
		const result = await s.call();
		const expected = { results: [{ ...HIT, ...fields("[SECRET:12345678]") }] };
		expect(exactMask).toHaveBeenCalledWith(secret);
		expect(result.structuredContent).toEqual(expected);
		expect(result.content).toEqual([
			{ type: "text", text: JSON.stringify(expected) },
		]);
		failOptional = true;
		expect((await s.call()).content).toEqual(IO);
	});
	it.each(["cancel", "shutdown", "mask-cancel", "mask-shutdown"])(
		"suppresses late success: %s",
		async (action) => {
			s = await serve();
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const aborted = Promise.withResolvers<void>();
			const wait = async () => {
				entered.resolve();
				await release.promise;
			};
			const run = async (_input: unknown, ctx: ToolContext) => {
				ctx.signal.addEventListener("abort", () => aborted.resolve(), {
					once: true,
				});
				if (!action.startsWith("mask")) await wait();
				return OK;
			};
			s.provide("knowledge.search@1", { run });
			if (action.startsWith("mask")) {
				s.masking.dispose();
				s.provide("secrets.mask@1", {
					mask: async (text: string) => {
						await wait();
						return mask(text);
					},
				});
			}
			const controller = new AbortController();
			const pending = s.call("query", controller.signal);
			const rejected = expect(pending).rejects.toBeDefined();
			await entered.promise;
			if (action.endsWith("shutdown")) await s.module.deactivate();
			else controller.abort();
			await aborted.promise;
			release.resolve();
			await rejected;
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(JSON.stringify(s.replies.mock.calls)).not.toContain(
				"structuredContent",
			);
		},
	);
});
