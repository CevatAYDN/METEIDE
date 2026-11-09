import {
	DAEMON_METHODS,
	DaemonSkillsListResultSchema,
	err,
	ok,
	type SkillMutationResult,
	type SkillTrustAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancellationTokenSource } from "vscode-jsonrpc/node";
import {
	mutation,
	preview,
	previewId,
	skillProtocol,
	sourceId,
} from "./skill-protocol-fixture.js";

let fixture: ReturnType<typeof skillProtocol> | undefined;
afterEach(() => fixture?.close());
const setup = async () => {
	fixture = skillProtocol();
	const listed = DaemonSkillsListResultSchema.parse(
		await fixture.client.sendRequest(DAEMON_METHODS.skillsList, {}),
	);
	if (!listed.ok) throw new Error("inventory failed");
	return { ...fixture, sessionId: listed.value.sessionId };
};
const deferred = <T>() => {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

describe("skill request identity and cancellation races", () => {
	it("refuses a replaced read adapter and uses the new native adapter on the next call", async () => {
		const t = await setup();
		const wait = deferred<Awaited<ReturnType<SkillTrustAdapter["prepare"]>>>();
		t.prepare.mockReturnValueOnce(wait.promise);
		const pending = t.client.sendRequest(DAEMON_METHODS.skillsPrepare, {
			sessionId: t.sessionId,
			sourceId,
		});
		await vi.waitFor(() => expect(t.prepare).toHaveBeenCalledOnce());
		t.registration.dispose();
		const replacement = { ...t.impl };
		t.natives.add(replacement);
		t.provide(replacement);
		wait.resolve(ok(preview));
		expect(await pending).toEqual(err({ code: "unavailable" }));
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsPrepare, {
				sessionId: t.sessionId,
				sourceId,
			}),
		).toEqual(ok({ ...preview, sessionId: t.sessionId }));
	});

	it.each(["object", "implementation"] as const)(
		"retains admission when the selected registry %s changes during mutation",
		async (target) => {
			const t = await setup();
			const wait = deferred<SkillMutationResult>();
			t.approve.mockReturnValueOnce(wait.promise);
			const pending = t.client.sendRequest(DAEMON_METHODS.skillsApprove, {
				sessionId: t.sessionId,
				previewId,
			});
			await vi.waitFor(() => expect(t.approve).toHaveBeenCalledOnce());
			if (target === "object") {
				t.registration.dispose();
				t.provide(t.impl);
			} else {
				const replacement = { ...t.impl };
				t.natives.add(replacement);
				const current = t.registry.resolve("skill.trust@1");
				if (!current.ok) throw new Error("fixture adapter missing");
				Object.defineProperty(current.value[0], "impl", { value: replacement });
			}
			wait.resolve(mutation);
			expect(await pending).toEqual({
				admitted: true,
				result: err({ code: "unavailable" }),
			});
		},
	);

	it("retains admission when a post-result registry recheck throws", async () => {
		const t = await setup();
		const resolve = t.registry.resolve.bind(t.registry);
		t.approve.mockImplementationOnce(async () => {
			t.registry.resolve = () => {
				throw new Error("secret sentinel");
			};
			return mutation;
		});
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsApprove, {
				sessionId: t.sessionId,
				previewId,
			}),
		).toEqual({ admitted: true, result: err({ code: "unavailable" }) });
		t.registry.resolve = resolve;
	});

	it.each(["list", "prepare", "approve", "disable"] as const)(
		"bridges %s cancellation and never returns success after cancellation",
		async (operation) => {
			const t = await setup();
			const wait = deferred<void>();
			let signal: AbortSignal | undefined;
			const block = async (current: AbortSignal) => {
				signal = current;
				await wait.promise;
			};
			t.status.mockImplementationOnce(async (current) => {
				await block(current);
				return ok({ entries: [], complete: true, diagnostics: [] });
			});
			t.prepare.mockImplementationOnce(async (_, current) => {
				await block(current);
				return ok(preview);
			});
			t.approve.mockImplementationOnce(async (_, current) => {
				await block(current);
				return mutation;
			});
			t.disable.mockImplementationOnce(async (_, current) => {
				await block(current);
				return mutation;
			});
			const requests = {
				list: [DAEMON_METHODS.skillsList, {}],
				prepare: [
					DAEMON_METHODS.skillsPrepare,
					{ sessionId: t.sessionId, sourceId },
				],
				approve: [
					DAEMON_METHODS.skillsApprove,
					{ sessionId: t.sessionId, previewId },
				],
				disable: [
					DAEMON_METHODS.skillsDisable,
					{
						sessionId: t.sessionId,
						sourceId,
						expectedRevision: 1,
					},
				],
			} as const;
			const [method, params] = requests[operation];
			const cancellation = new CancellationTokenSource();
			const pending = t.client.sendRequest(method, params, cancellation.token);
			await vi.waitFor(() => expect(signal).toBeDefined());
			cancellation.cancel();
			await vi.waitFor(() => expect(signal?.aborted).toBe(true));
			wait.resolve();
			const result = err({ code: "aborted" });
			expect(await pending).toEqual(
				operation === "list" || operation === "prepare"
					? result
					: { admitted: true, result },
			);
			cancellation.dispose();
		},
	);
});
