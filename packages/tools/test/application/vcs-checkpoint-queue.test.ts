import {
	err,
	ok,
	type Result,
	type VcsError,
	type VcsGitAdapter,
	type VcsGitOutput,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { serializeCheckpoints } from "../../src/application/vcs-checkpoint-queue.js";

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const OTHER = "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6";
const input = { op: "checkpoint.create", runId: RUN } as const;
const ctx = { signal: new AbortController().signal };
const done = ok({ op: "checkpoint.create", ref: "ref", sha: "sha" } as const);
const deferred = () => {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
};

describe("adapter-owned checkpoint queue", () => {
	it("orders same-run calls but not other runs, operations or adapter instances", async () => {
		const held = deferred();
		const started = deferred();
		const calls: string[] = [];
		const adapter: VcsGitAdapter = {
			run: async (i, c) => {
				calls.push(c.cwd ?? i.op);
				if (c.cwd === "first") {
					started.release();
					await held.promise;
				}
				return done;
			},
		};
		const queued = serializeCheckpoints(adapter);
		const first = queued.run(input, { ...ctx, cwd: "first" });
		await started.promise;
		const second = queued.run(input, { ...ctx, cwd: "second" });
		const third = queued.run(input, { ...ctx, cwd: "third" });
		await queued.run({ ...input, runId: OTHER }, ctx);
		await queued.run({ op: "status" }, ctx);
		await serializeCheckpoints(adapter).run(input, ctx);
		expect(calls).toEqual([
			"first",
			"checkpoint.create",
			"status",
			"checkpoint.create",
		]);
		held.release();
		expect(await Promise.all([first, second, third])).toEqual([
			done,
			done,
			done,
		]);
		expect(calls.slice(-2)).toEqual(["second", "third"]);
		expect(await queued.run(input, ctx)).toBe(done);
	});

	it.each(["result", "throw", "sync-throw", "abort"] as const)(
		"releases a %s predecessor without changing its outcome",
		async (failure) => {
			const held = deferred();
			const started = deferred();
			const controller = new AbortController();
			const refused: Result<VcsGitOutput, VcsError> = err({
				code: "io",
				message: "checkpoint failed",
			});
			const bug = new Error("checkpoint bug");
			let calls = 0;
			const queued = serializeCheckpoints({
				run: (_i, c) => {
					calls += 1;
					if (calls > 1) return Promise.resolve(done);
					started.release();
					if (failure === "sync-throw") throw bug;
					return held.promise.then(() => {
						if (failure === "throw") throw bug;
						if (failure === "abort") expect(c.signal.aborted).toBe(true);
						return refused;
					});
				},
			});
			const first = queued.run(input, { signal: controller.signal });
			const observed = first.then(
				(value) => value,
				(error: unknown) => error,
			);
			await started.promise;
			const second = queued.run(input, ctx);
			if (failure === "abort") controller.abort();
			expect(calls).toBe(1);
			held.release();
			expect(await observed).toBe(failure.endsWith("throw") ? bug : refused);
			expect(await second).toBe(done);
			expect(await queued.run(input, ctx)).toBe(done);
			expect(calls).toBe(3);
		},
	);
});
