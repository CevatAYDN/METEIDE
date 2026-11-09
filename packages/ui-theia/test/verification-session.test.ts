import { err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import { createVerificationSession } from "../src/application/verification-session.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";
import {
	VERIFICATION_RUN,
	verificationFixture,
} from "./verification-fixture.js";

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
};
const setup = () => {
	const fetch = vi.fn<MeteDaemonService["verification"]>(async () =>
		ok(verificationFixture),
	);
	const session = createVerificationSession({ fetch, changed: vi.fn() });
	return { fetch, session };
};

it("distinguishes loading, successful empty evidence and unavailable reads", async () => {
	const { fetch, session } = setup();
	const read = deferred<Awaited<ReturnType<typeof fetch>>>();
	fetch.mockReturnValueOnce(read.promise);
	const loading = session.show("/w", VERIFICATION_RUN);
	expect(session.state).toMatchObject({ phase: "loading", result: undefined });
	read.resolve(ok({ mode: "legacy", tasks: [] }));
	await loading;
	expect(session.state).toMatchObject({
		phase: "ready",
		result: { mode: "legacy", tasks: [] },
	});
	fetch.mockResolvedValueOnce(
		err({ code: "not_ready", detail: "missing core" }),
	);
	await session.refresh();
	expect(session.state).toMatchObject({
		phase: "failed",
		failure: { code: "not_ready" },
	});
	expect(session.state.result).toEqual({ mode: "legacy", tasks: [] });
});

it("drops late success and error across workspace/run/reselection generations", async () => {
	for (const next of ["/other", "/w"]) {
		const { fetch, session } = setup();
		const old = deferred<Awaited<ReturnType<typeof fetch>>>();
		fetch.mockReturnValueOnce(old.promise);
		const loading = session.show("/w", VERIFICATION_RUN);
		await session.show(next, VERIFICATION_RUN);
		old.resolve(err({ code: "refused", detail: "old selection" }));
		await loading;
		expect(session.state).toMatchObject({
			phase: "ready",
			result: verificationFixture,
		});
		const late = deferred<Awaited<ReturnType<typeof fetch>>>();
		fetch.mockReturnValueOnce(late.promise);
		const refresh = session.refresh();
		await session.show("/w", "55555555-5555-4555-8555-555555555555");
		late.resolve(ok({ mode: "legacy", tasks: [] }));
		await refresh;
		expect(session.state.result).toEqual(verificationFixture);
	}
});

it("drops superseded same-selection refreshes and retains no data after clear", async () => {
	const { fetch, session } = setup();
	await session.show("/w", VERIFICATION_RUN);
	const old = deferred<Awaited<ReturnType<typeof fetch>>>();
	fetch.mockReturnValueOnce(old.promise);
	const first = session.refresh();
	await session.refresh();
	old.resolve(ok({ mode: "legacy", tasks: [] }));
	await first;
	expect(session.state.result).toEqual(verificationFixture);
	const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
	fetch.mockReturnValueOnce(pending.promise);
	const last = session.refresh();
	session.clear();
	pending.resolve(ok(verificationFixture));
	await last;
	expect(session.state).toMatchObject({ phase: "idle", result: undefined });
});

it("fails malformed/rejected reads without manufacturing an empty snapshot", async () => {
	const { fetch, session } = setup();
	fetch.mockResolvedValueOnce(ok({ ...verificationFixture, extra: true }));
	await session.show("/w", VERIFICATION_RUN);
	expect(session.state).toMatchObject({
		phase: "failed",
		result: undefined,
		failure: { code: "protocol" },
	});
	fetch.mockRejectedValueOnce(new Error("closed"));
	await session.refresh();
	expect(session.state).toMatchObject({ phase: "failed", result: undefined });
	await session.refresh();
	expect(session.state).toMatchObject({
		phase: "ready",
		result: verificationFixture,
	});
});

it("uses exact verification notifications only as wakeups, including while a read is pending", async () => {
	const { fetch, session } = setup();
	await session.show("/w", VERIFICATION_RUN);
	for (const [dir, runId, type] of [
		["/other", VERIFICATION_RUN, "verify.updated"],
		["/w", "other", "verify.evaluated"],
		["/w", VERIFICATION_RUN, "verify.completed"],
	])
		session.onEvent(dir ?? "", { runId, type: type ?? "" });
	expect(fetch).toHaveBeenCalledTimes(1);
	const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
	fetch.mockReturnValueOnce(pending.promise);
	const old = session.refresh();
	session.onEvent("/w", { runId: VERIFICATION_RUN, type: "verify.updated" });
	await vi.waitFor(() => expect(session.state.phase).toBe("ready"));
	pending.resolve(ok({ mode: "legacy", tasks: [] }));
	await old;
	expect(session.state.result).toEqual(verificationFixture);
	session.onEvent("/w", { runId: VERIFICATION_RUN, type: "verify.evaluated" });
	expect(fetch).toHaveBeenCalledTimes(4);
});

it.each([
	"task.created",
	"task.assigned",
	"task.status.changed",
	"task.attempt.chosen",
	"task.waiting",
	"task.wait.resolved",
	"run.started",
	"run.resumed",
	"run.paused",
	"run.completed",
	"run.failed",
	"run.cancelled",
])(
	"re-reads current attempt identity on exact %s without inferring evidence from it",
	async (type) => {
		const { fetch, session } = setup();
		await session.show("/w", VERIFICATION_RUN);
		const next = {
			...verificationFixture,
			tasks: verificationFixture.tasks.map((task) => ({
				...task,
				currentAttemptId: "55555555-5555-4555-8555-555555555555",
			})),
		};
		const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
		fetch.mockReturnValueOnce(pending.promise);
		const oldRead = session.refresh();
		fetch.mockResolvedValueOnce(ok(next));
		session.onEvent("/elsewhere", { runId: VERIFICATION_RUN, type });
		session.onEvent("/w", { runId: "another-run", type });
		expect(fetch).toHaveBeenCalledTimes(2);
		session.onEvent("/w", { runId: VERIFICATION_RUN, type });
		expect(session.state.phase).toBe("loading");
		await vi.waitFor(() => expect(session.state.result).toEqual(next));
		pending.resolve(ok(verificationFixture));
		await oldRead;
		expect(session.state.result).toEqual(next);
		expect(fetch).toHaveBeenCalledTimes(3);
	},
);

it("clears removed-run evidence and rejects its pending read", async () => {
	const { fetch, session } = setup();
	const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
	fetch.mockReturnValueOnce(pending.promise);
	const loading = session.show("/w", VERIFICATION_RUN);
	session.onEvent("/w", { runId: VERIFICATION_RUN, type: "run.removed" });
	pending.resolve(ok(verificationFixture));
	await loading;
	expect(session.state).toMatchObject({ phase: "idle", result: undefined });
});
