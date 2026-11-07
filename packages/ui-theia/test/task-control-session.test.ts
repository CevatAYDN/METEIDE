import { err, ok, type TaskPending } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import {
	createTaskControlSession,
	type TaskControlSession,
} from "../src/application/task-control-session.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const OTHER_RUN = "44444444-4444-4444-8444-444444444444";
const STALE_REQUEST = "55555555-5555-4555-8555-555555555555";
const RENEWED_REQUEST = "66666666-6666-4666-8666-666666666666";

const request: TaskPending = {
	runId: RUN,
	taskId: TASK,
	requestId: REQUEST,
	templateTaskId: "write",
	title: "Write",
	kind: "approval",
};
const answer = {
	runId: RUN,
	taskId: TASK,
	requestId: REQUEST,
	decision: "approve",
} as const;
const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
};
const setup = () => {
	const fetch = vi.fn<MeteDaemonService["taskPending"]>(async () =>
		ok({ requests: [request] }),
	);
	const send = vi.fn<MeteDaemonService["taskAnswer"]>(async () => ok(null));
	const changed = vi.fn();
	return {
		fetch,
		send,
		changed,
		session: createTaskControlSession({ fetch, send, changed }),
	};
};

it("exposes a named session type and ignores events with an explicitly undefined run ID", async () => {
	const t = setup();
	const session: TaskControlSession = t.session;
	await session.show("/w", RUN);
	session.onEvent("/w", { type: "run.completed", runId: undefined });
	expect(session.state.phase).toBe("ready");
	expect(session.state.requests).toEqual([request]);
	expect(t.fetch).toHaveBeenCalledTimes(1);
});

it("drops old fetches, including a same-run refresh and a workspace switch", async () => {
	const t = setup();
	const old = deferred<Awaited<ReturnType<typeof t.fetch>>>();
	t.fetch.mockReturnValueOnce(old.promise);
	const loading = t.session.show("/w", RUN);
	expect(t.session.state.phase).toBe("loading");
	await t.session.refresh();
	old.resolve(err({ code: "refused", detail: "late" }));
	await loading;
	expect(t.session.state.phase).toBe("ready");
	const next = deferred<Awaited<ReturnType<typeof t.fetch>>>();
	t.fetch.mockReturnValueOnce(next.promise);
	const switching = t.session.show("/w", RUN);
	await t.session.show("/other", RUN);
	next.resolve(ok({ requests: [] }));
	await switching;
	expect(t.session.state.requests).toEqual([request]);
});

it("locks exact answers across navigation and suppresses duplicate sends", async () => {
	const t = setup();
	const pending = deferred<Awaited<ReturnType<typeof t.send>>>();
	t.send.mockReturnValue(pending.promise);
	await t.session.show("/w", RUN);
	const first = t.session.answer(answer);
	await t.session.answer(answer);
	expect(t.session.state.busy).toEqual([REQUEST]);
	await t.session.show("/other", RUN);
	expect(t.session.state.busy).toEqual([]);
	await t.session.show("/w", RUN);
	expect(t.session.state.busy).toEqual([REQUEST]);
	pending.resolve(ok(null));
	await first;
	await t.session.answer(answer);
	expect(t.send).toHaveBeenCalledExactlyOnceWith("/w", answer);
	expect(t.session.state.requests).toEqual([]);
});

it("rejects stale targets and keeps failed submissions retryable", async () => {
	const t = setup();
	await t.session.show("/w", RUN);
	await t.session.answer({ ...answer, requestId: STALE_REQUEST });
	await t.session.answer({ ...answer, runId: OTHER_RUN });
	expect(t.send).not.toHaveBeenCalled();
	t.send.mockResolvedValueOnce(
		err({ code: "refused", detail: "stale attempt" }),
	);
	await t.session.answer(answer);
	expect(t.session.state.errors[REQUEST]).toBe("stale attempt");
	expect(t.session.state.busy).toEqual([]);
	expect(t.session.state.requests).toEqual([request]);
	await t.session.answer(answer);
	expect(t.send).toHaveBeenCalledTimes(2);
});

it("fails closed on unavailable, malformed and cross-run state", async () => {
	const t = setup();
	for (const result of [
		err({ code: "refused" as const, detail: "not supported" }),
		ok({ requests: [], extra: true }),
		ok({ requests: [{ ...request, runId: OTHER_RUN }] }),
		ok({ requests: [request, request] }),
	]) {
		t.fetch.mockResolvedValueOnce(result);
		await t.session.show("/w", RUN);
		expect(t.session.state.phase).toBe("failed");
		await t.session.answer(answer);
	}
	expect(t.send).not.toHaveBeenCalled();
});

it("refreshes only matching task events and ignores late replies after clear", async () => {
	const t = setup();
	await t.session.show("/w", RUN);
	t.session.onEvent("/other", { runId: RUN, type: "task.waiting" });
	t.session.onEvent("/w", { runId: OTHER_RUN, type: "task.waiting" });
	expect(t.fetch).toHaveBeenCalledTimes(1);
	t.session.onEvent("/w", { runId: RUN, type: "task.wait.resolved" });
	expect(t.fetch).toHaveBeenCalledTimes(2);
	const pending = deferred<Awaited<ReturnType<typeof t.fetch>>>();
	t.fetch.mockReturnValueOnce(pending.promise);
	const load = t.session.refresh();
	t.session.clear();
	pending.resolve(ok({ requests: [request] }));
	await load;
	expect(t.session.state.phase).toBe("idle");
});

const endedEvents = ["run.cancelled", "run.completed", "run.failed"];

it.each(endedEvents)(
	"%s clears ready/loading controls and invalidates old fetches",
	async (type) => {
		for (const fetching of [false, true]) {
			const t = setup();
			await t.session.show("/w", RUN);
			const old = deferred<Awaited<ReturnType<typeof t.fetch>>>();
			t.fetch.mockReturnValueOnce(old.promise);
			const loading = fetching ? t.session.refresh() : Promise.resolve();
			t.session.onEvent("/other", { runId: RUN, type });
			t.session.onEvent("/w", { runId: OTHER_RUN, type });
			expect(t.session.state.requests).toEqual([request]);
			t.session.onEvent("/w", { runId: RUN, type });
			expect(t.session.state).toMatchObject({
				phase: "idle",
				requests: [],
				busy: [],
				errors: {},
			});
			await t.session.answer(answer);
			expect(t.send).not.toHaveBeenCalled();
			old.resolve(ok({ requests: [request] }));
			await loading;
			expect(t.session.state.requests).toEqual([]);
			t.session.onEvent("/w", { runId: RUN, type: "task.waiting" });
			t.session.onEvent("/w", { runId: RUN, type: "task.wait.resolved" });
			await t.session.refresh();
			await t.session.show("/w", RUN);
			expect(t.fetch).toHaveBeenCalledTimes(fetching ? 2 : 1);
			await t.session.show("/other", RUN);
			expect(t.session.state.requests).toEqual([request]);
		}
	},
);

it.each(endedEvents)(
	"%s prevents late answer success or failure from restoring controls",
	async (type) => {
		for (const success of [true, false]) {
			const t = setup();
			const reply = deferred<Awaited<ReturnType<typeof t.send>>>();
			t.send.mockReturnValueOnce(reply.promise);
			await t.session.show("/w", RUN);
			const sending = t.session.answer(answer);
			expect(t.session.state.busy).toEqual([REQUEST]);
			t.session.onEvent("/w", { runId: RUN, type });
			expect(t.session.state.requests).toEqual([]);
			expect(t.session.state.busy).toEqual([]);
			reply.resolve(
				success ? ok(null) : err({ code: "refused", detail: "late failure" }),
			);
			await sending;
			expect(t.session.state).toMatchObject({
				phase: "idle",
				requests: [],
				busy: [],
				errors: {},
				failure: undefined,
			});
			expect(t.fetch).toHaveBeenCalledTimes(1);
			await t.session.answer(answer);
			expect(t.send).toHaveBeenCalledTimes(1);
		}
	},
);

it("refreshes renewed request identities on resume and discards pre-resume fetches", async () => {
	const t = setup();
	const old = deferred<Awaited<ReturnType<typeof t.fetch>>>();
	t.fetch.mockReturnValueOnce(old.promise);
	const loading = t.session.show("/w", RUN);
	const renewed = { ...request, requestId: RENEWED_REQUEST };
	t.fetch.mockResolvedValue(ok({ requests: [renewed] }));
	t.session.onEvent("/other", { runId: RUN, type: "run.resumed" });
	t.session.onEvent("/w", { runId: OTHER_RUN, type: "run.resumed" });
	expect(t.fetch).toHaveBeenCalledTimes(1);
	t.session.onEvent("/w", { runId: RUN, type: "run.resumed" });
	expect(t.session.state.phase).toBe("loading");
	await vi.waitFor(() => expect(t.session.state.requests).toEqual([renewed]));
	old.resolve(ok({ requests: [request] }));
	await loading;
	expect(t.session.state.requests).toEqual([renewed]);
	await t.session.answer(answer);
	expect(t.send).not.toHaveBeenCalled();
	await t.session.answer({ ...answer, requestId: RENEWED_REQUEST });
	expect(t.send).toHaveBeenCalledExactlyOnceWith("/w", {
		...answer,
		requestId: RENEWED_REQUEST,
	});
});

it("retains in-flight locks through end/resume without copying late errors into the resumed UI", async () => {
	const t = setup();
	const reply = deferred<Awaited<ReturnType<typeof t.send>>>();
	t.send.mockReturnValueOnce(reply.promise);
	await t.session.show("/w", RUN);
	const sending = t.session.answer(answer);
	t.session.onEvent("/w", { runId: RUN, type: "run.failed" });
	t.session.onEvent("/w", { runId: RUN, type: "run.resumed" });
	await vi.waitFor(() => expect(t.session.state.phase).toBe("ready"));
	expect(t.session.state.busy).toEqual([REQUEST]);
	await t.session.answer(answer);
	expect(t.send).toHaveBeenCalledTimes(1);
	reply.resolve(err({ code: "refused", detail: "old attempt" }));
	await sending;
	expect(t.session.state.errors).toEqual({});
	expect(t.session.state.busy).toEqual([]);
});
