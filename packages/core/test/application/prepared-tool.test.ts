import { resolve } from "node:path";
import { ok, type ToolIsolationAdapter } from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { describe, expect, it } from "vitest";
import {
	prepareWriter,
	rootsOverlap,
} from "../../src/application/prepared-tool.js";
import { callTool } from "../../src/application/steps.js";
import { SINGLE_AGENT } from "../../src/domain/tools.js";

const call = { id: "c", name: "fs_write", args: { path: "a", content: "a" } };
const signal = new AbortController().signal;
const root = resolve("fixture-tree");
const setup = () => {
	let binding: string[] = [];
	const registry = createCapabilityRegistry(() => binding);
	const ran: string[] = [];
	const provide = (id: string) =>
		registry.provide("fs.write@1", {
			id,
			trust: "core",
			features: [],
			impl: {
				run: async () => {
					ran.push(id);
					return ok({ bytes: 1 });
				},
			},
		});
	const describe = (id: string, value: unknown, trust = "core" as const) =>
		registry.provide<ToolIsolationAdapter>("tool.isolation@1", {
			id,
			trust,
			features: [],
			impl: {
				inspect: async () =>
					value as Awaited<ReturnType<ToolIsolationAdapter["inspect"]>>,
			},
		});
	return {
		registry,
		ran,
		provide,
		describe,
		bind: (ids: string[]) => {
			binding = ids;
		},
		deps: {
			registry,
			now: () => 0,
			newId: () => "id",
			logger: { error() {}, warn() {}, info() {}, debug() {} },
		},
	};
};

describe("verified writer chain", () => {
	it("requires valid confinement from every adapter, not only the first", async () => {
		const h = setup();
		h.provide("first");
		h.provide("fallback");
		h.describe("first", ok({ scope: "worktree", root }));
		expect(await prepareWriter(h.registry, call, root, signal)).toBeUndefined();
		h.describe("fallback", ok({ scope: "worktree", root }));
		expect(await prepareWriter(h.registry, call, root, signal)).toMatchObject({
			ref: "fs.write@1",
			root,
		});
	});

	it.each([null, {}, ok({ scope: "worktree" }), ok({ scope: "workspace" })])(
		"fails closed on an invalid or workspace claim: %j",
		async (claim) => {
			const h = setup();
			h.provide("first");
			h.describe("first", claim);
			expect(
				await prepareWriter(h.registry, call, root, signal),
			).toBeUndefined();
		},
	);

	it("does not execute a replacement adapter after preparing a writer", async () => {
		const h = setup();
		const old = h.provide("first");
		h.describe("first", ok({ scope: "worktree", root }));
		const prepared = await prepareWriter(h.registry, call, root, signal);
		expect(prepared).toBeDefined();
		old.dispose();
		h.provide("first");
		const result = await callTool(
			h.deps,
			{ call, seat: SINGLE_AGENT, prepared },
			{ cwd: root, signal },
			() => {},
		);
		expect(result).toMatchObject({ kind: "result" });
		expect(h.ran).toEqual([]);
	});

	it("refuses a binding-order change and never dispatches unchecked fallback", async () => {
		const h = setup();
		for (const id of ["first", "fallback"]) {
			h.provide(id);
			h.describe(id, ok({ scope: "worktree", root }));
		}
		const prepared = await prepareWriter(h.registry, call, root, signal);
		h.bind(["fallback", "first"]);
		await callTool(
			h.deps,
			{ call, seat: SINGLE_AGENT, prepared },
			{ cwd: root, signal },
			() => {},
		);
		expect(h.ran).toEqual([]);
	});

	it("uses the captured chain while it is still current", async () => {
		const h = setup();
		h.provide("first");
		h.describe("first", ok({ scope: "worktree", root }));
		const prepared = await prepareWriter(h.registry, call, root, signal);
		await callTool(
			h.deps,
			{ call, seat: SINGLE_AGENT, prepared },
			{ cwd: root, signal },
			() => {},
		);
		expect(h.ran).toEqual(["first"]);
	});

	it("detects equal and nested roots without confusing siblings", () => {
		expect(rootsOverlap(root, root)).toBe(true);
		expect(rootsOverlap(root, resolve(root, "nested"))).toBe(true);
		expect(rootsOverlap(resolve(root, "a"), resolve(root, "b"))).toBe(false);
	});
});
