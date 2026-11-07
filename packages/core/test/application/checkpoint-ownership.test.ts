import { setImmediate as tick } from "node:timers/promises";
import { ok, type VcsGitAdapter } from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { describe, expect, it } from "vitest";
import {
	createCheckpointQueue,
	verifiedCheckpointAdapter,
} from "../../src/application/checkpoint-queue.js";
import { createCheckpoint } from "../../src/application/vcs-steps.js";

const signal = new AbortController().signal;
const fixture = () => {
	const registry = createCapabilityRegistry(() => []);
	const checkpointAdapters = new WeakSet<VcsGitAdapter>();
	const checkpointQueue = createCheckpointQueue();
	const calls: string[] = [];
	const adapter = (label: string, wait = Promise.resolve()): VcsGitAdapter => ({
		run: async (_input, ctx) => {
			calls.push(`${label}:${ctx.cwd ?? "workspace"}`);
			await wait;
			return ok({ op: "checkpoint.create", ref: label, sha: "saved" });
		},
	});
	const provide = (impl: VcsGitAdapter) =>
		registry.provide("vcs.git@2", {
			id: "fixture-vcs",
			trust: "core",
			features: [],
			impl,
		});
	return {
		registry,
		checkpointAdapters,
		checkpointQueue,
		calls,
		adapter,
		provide,
	};
};

describe("checkpoint ownership", () => {
	it("requires the exact composition-attested object, not its name or a delegating wrapper", () => {
		const h = fixture();
		const native = h.adapter("native");
		h.checkpointAdapters.add(native);
		const first = h.provide(native);
		expect(verifiedCheckpointAdapter(h)).toBe(native);
		first.dispose();
		h.provide({
			run: (input, ctx) => native.run(input, { signal: ctx.signal }),
		});
		expect(verifiedCheckpointAdapter(h)).toBeUndefined();
	});

	it("serializes worktree and workspace checkpoints across adapter replacement", async () => {
		const h = fixture();
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = h.provide(h.adapter("old", gate));
		const a = createCheckpoint(h, { runId: "run", cwd: "tree", signal });
		await tick();
		first.dispose();
		h.provide(h.adapter("new"));
		const b = createCheckpoint(h, { runId: "run", signal });
		await tick();
		expect(h.calls).toEqual(["old:tree"]);
		release();
		expect(await a).toEqual(ok("old"));
		expect(await b).toEqual(ok("new"));
		expect(h.calls).toEqual(["old:tree", "new:workspace"]);
	});

	it("never invokes a captured checkpoint adapter replaced while queued", async () => {
		const h = fixture();
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const original = h.adapter("old", gate);
		const first = h.provide(original);
		const a = createCheckpoint(h, { runId: "run", signal });
		const b = createCheckpoint(
			h,
			{ runId: "run", cwd: "tree", signal },
			original,
		);
		await tick();
		first.dispose();
		h.provide(h.adapter("new"));
		release();
		await a;
		expect(await b).toEqual(ok(undefined));
		expect(h.calls).toEqual(["old:workspace"]);
	});

	it("releases a failed allocation and does not serialize different runs", async () => {
		const queue = createCheckpointQueue();
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const a = queue("a", async () => {
			await gate;
			throw new Error("failed");
		});
		const failed = expect(a).rejects.toThrow("failed");
		expect(await queue("b", async () => "independent")).toBe("independent");
		const next = queue("a", async () => "next");
		release();
		await failed;
		expect(await next).toBe("next");
	});
});
