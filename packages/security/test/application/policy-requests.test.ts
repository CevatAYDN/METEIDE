import type {
	PolicyCheckInput,
	PolicyForgetInput,
	PolicyGrantRequest,
	PolicyPendingInput,
	PolicyVerdict,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createPolicyRequests } from "../../src/application/policy-requests.js";

const runId = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const agentId = "8f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const otherId = "9f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const identity = { runId, agentId };
const input: PolicyCheckInput = {
	...identity,
	action: "fs.write",
	capability: "fs.write@1",
	adapterId: "test-adapter",
	args: { content: "secret" },
	path: "/repo/secret",
};
const ask: PolicyVerdict = { verdict: "ask", rule: "autonomy:1" };
const setup = () =>
	createPolicyRequests({
		mask: async (text) => text.replace("secret", "[SECRET:tag]"),
		newId: () => crypto.randomUUID(),
	});
const ticket = async (store: ReturnType<typeof setup>) => {
	const result = await store.pending(identity);
	if (!result.ok || !result.value.requests[0])
		throw new Error("missing request");
	return {
		...identity,
		requestId: result.value.requests[0].requestId,
		scope: "once" as const,
	};
};

describe("exact policy requests", () => {
	it("masks display data, never exposes args, and retains an unchanged pending identity", async () => {
		const store = setup();
		expect(store.remember(input, ask)).toEqual({ ok: true, value: undefined });
		const first = await ticket(store);
		store.remember(input, ask);
		expect(await ticket(store)).toEqual(first);
		expect(await store.pending(identity)).toEqual({
			ok: true,
			value: {
				requests: [
					{
						...identity,
						requestId: first.requestId,
						rule: "autonomy:1",
						ask: {
							action: "fs.write",
							capability: "fs.write@1",
							adapterId: "test-adapter",
							path: "/repo/[SECRET:tag]",
						},
					},
				],
			},
		});
	});

	it("rejects cross-task theft, duplicate answers and superseded requests", async () => {
		const store = setup();
		store.remember(input, ask);
		const first = await ticket(store);
		expect(store.grant({ ...first, agentId: otherId })).toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
		expect(store.grant({ ...first, runId: otherId })).toMatchObject({
			ok: false,
		});
		store.remember({ ...input, args: { content: "changed" } }, ask);
		expect((await ticket(store)).requestId).not.toBe(first.requestId);
		expect(store.grant(first)).toMatchObject({ ok: false });
		const current = await ticket(store);
		expect(store.grant(current)).toEqual({ ok: true, value: undefined });
		expect(store.grant(current)).toMatchObject({ ok: false });
	});

	it.each([
		{ args: { content: "changed" } },
		{ action: "fs.delete" as const },
		{ capability: "fs.edit@1" as const },
		{ adapterId: "other" },
		{ path: "/repo/other" },
		{ command: "replacement" },
		{ runId: otherId },
		{ agentId: otherId },
	])("does not match changed identity %j", async (change) => {
		const store = setup();
		store.remember(input, ask);
		store.grant(await ticket(store));
		expect(store.take({ ...input, ...change })).toBeUndefined();
		expect(store.take(input)).toBe("once");
		expect(store.take(input)).toBeUndefined();
	});

	it("keeps immutable args identity and prevents task grants on tainted calls", async () => {
		const store = setup();
		const args = { content: "secret" };
		store.remember({ ...input, args }, ask);
		args.content = "changed";
		store.grant({ ...(await ticket(store)), scope: "task" });
		expect(store.take({ ...input, args })).toBeUndefined();
		expect(store.take({ ...input, tainted: true })).toBeUndefined();
		expect(store.take(input)).toBe("task");
		expect(store.take(input)).toBe("task");
		store.forget(identity);
		expect(store.take(input)).toBeUndefined();
	});

	it("forgets one agent or an entire run, including grants", async () => {
		const store = setup();
		store.remember(input, ask);
		store.grant(await ticket(store));
		store.remember({ ...input, agentId: otherId }, ask);
		store.forget(identity);
		expect(store.take(input)).toBeUndefined();
		expect(await store.pending(identity)).toEqual({
			ok: true,
			value: { requests: [] },
		});
		store.forget({ runId });
		expect(await store.pending({ runId, agentId: otherId })).toEqual({
			ok: true,
			value: { requests: [] },
		});
	});

	it.each(["forget", "forget-run", "replace", "grant"] as const)(
		"drops stale masking completion after %s",
		async (operation) => {
			const masked = Promise.withResolvers<string>();
			let hold = false;
			const store = createPolicyRequests({
				mask: async (text) => (hold ? masked.promise : text),
			});
			store.remember(input, ask);
			const first = await ticket(store);
			hold = true;
			const pending = store.pending(identity);
			const operations = {
				forget: () => store.forget(identity),
				"forget-run": () => store.forget({ runId }),
				replace: () =>
					store.remember({ ...input, args: { content: "changed" } }, ask),
				grant: () => store.grant(first),
			};
			operations[operation]();
			masked.resolve("masked");
			expect(await pending).toEqual({ ok: true, value: { requests: [] } });
			if (operation === "replace")
				expect((await ticket(store)).requestId).not.toBe(first.requestId);
		},
	);

	it("ignores unbound checks and rejects invalid internal check inputs", async () => {
		const store = setup();
		for (const missing of [{ runId: undefined }, { agentId: undefined }]) {
			const unbound: PolicyCheckInput = { ...input, ...missing };
			expect(store.remember(unbound, ask).ok).toBe(true);
			expect(store.take(unbound)).toBeUndefined();
		}
		const extra = { ...input, replacement: true };
		expect(store.remember(extra, ask).ok).toBe(false);
		expect(await store.pending(identity)).toEqual({
			ok: true,
			value: { requests: [] },
		});
	});

	it("fails closed on unserializable args instead of retaining a sentinel identity", async () => {
		const store = setup();
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		for (const args of [
			cyclic,
			1n,
			undefined,
			{ omitted: undefined },
			NaN,
			new Date(0),
			Object.defineProperty({ content: "secret" }, "hidden", {
				value: "different",
			}),
			Object.defineProperty({}, "content", {
				enumerable: true,
				get: () => "secret",
			}),
			{ nested: { content: Symbol("secret") } },
			{ nested: { content: () => "secret" } },
			{ toJSON: () => ({ content: "secret" }) },
		]) {
			store.remember(input, ask);
			expect(store.remember({ ...input, args }, ask)).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
			expect(await store.pending(identity)).toEqual({
				ok: true,
				value: { requests: [] },
			});
			expect(store.take({ ...input, args })).toBeUndefined();
		}
	});

	it("rejects malformed boundary inputs without consuming a live request", async () => {
		const store = setup();
		store.remember(input, ask);
		const first = await ticket(store);
		const invalidPending: unknown[] = [
			{},
			{ ...identity, runId: "bad" },
			{ ...identity, extra: true },
		];
		for (const raw of invalidPending)
			expect(await store.pending(raw as PolicyPendingInput)).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
		const invalidGrants: unknown[] = [
			{ ...first, runId: "bad" },
			{ ...first, agentId: "bad" },
			{ ...first, requestId: "bad" },
			{ ...first, requestId: undefined },
			{ ...first, scope: "run" },
			{ ...first, scope: "always" },
			{ ...first, path: "replacement" },
			{ ...first, args: {} },
		];
		for (const raw of invalidGrants)
			expect(store.grant(raw as PolicyGrantRequest)).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
		const invalidForget: unknown[] = [
			{},
			{ runId: "bad" },
			{ ...identity, agentId: "bad" },
		];
		for (const raw of invalidForget)
			expect(store.forget(raw as PolicyForgetInput)).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
		expect(await ticket(store)).toEqual(first);
		expect(store.grant(first).ok).toBe(true);
		expect(store.take(input)).toBe("once");
	});

	it("validates strict inputs and returns masking failures without leaking secrets", async () => {
		const store = setup();
		expect(await store.pending({ ...identity, agentId: "bad" })).toMatchObject({
			ok: false,
			error: { code: "bad_input" },
		});
		store.remember(input, ask);
		const replacement = { ...(await ticket(store)), command: "replacement" };
		expect(store.grant(replacement)).toMatchObject({
			ok: false,
			error: { code: "bad_input" },
		});
		const invalidForget = { ...identity, requestId: otherId };
		expect(store.forget(invalidForget)).toMatchObject({
			ok: false,
			error: { code: "bad_input" },
		});
		const failing = createPolicyRequests({
			mask: async () => {
				throw new Error("secret");
			},
		});
		failing.remember(input, ask);
		expect(await failing.pending(identity)).toEqual({
			ok: false,
			error: { code: "failed", message: "policy request masking failed" },
		});
	});
});
