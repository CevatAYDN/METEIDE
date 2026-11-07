import { err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import {
	createSentContext,
	sentContextEntries,
} from "../src/application/sent-context.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

it("keeps duplicate snapshots distinct with stable keys independent of unrelated attachment order", () => {
	const snapshot = {
		path: "a.ts",
		content: "same copy",
		modified: true,
		sha256: "a".repeat(64),
	};
	const other = { ...snapshot, path: "other.ts" };
	const first = sentContextEntries({
		runId: "turn",
		attachments: [snapshot, other, { ...snapshot }],
	});
	const reordered = sentContextEntries({
		runId: "turn",
		attachments: [other, { ...snapshot }, { ...snapshot }],
	});
	expect(first.map((entry) => entry.snapshot)).toEqual([
		snapshot,
		other,
		snapshot,
	]);
	expect(new Set(first.map((entry) => entry.key)).size).toBe(3);
	expect(reordered.map((entry) => entry.key)).toEqual([
		first[1]?.key,
		first[0]?.key,
		first[2]?.key,
	]);
	expect(
		sentContextEntries({
			runId: "turn",
			attachments: [snapshot, other, { ...snapshot }],
		}),
	).toEqual(first);
});

it("reads the selected immutable run and distinguishes an empty legacy turn from read failure", async () => {
	const shown = { dir: "/w", runId: "old", goal: "title" };
	const fetch = vi.fn<MeteDaemonService["threadContextRead"]>(
		async (_dir, input) => ok({ runId: input.runId, attachments: [] }),
	);
	const context = createSentContext({
		fetch: () => fetch,
		shown: () => shown,
		onChange: () => {},
	});
	await context.show(shown);
	expect(fetch).toHaveBeenCalledWith("/w", { runId: "old" });
	expect(context.state).toMatchObject({
		phase: "ready",
		result: { runId: "old", attachments: [] },
	});
	fetch.mockResolvedValue(err({ code: "stopped", detail: "" }));
	await context.refresh();
	expect(context.state.phase).toBe("failed");
	expect(context.state.result).toBeUndefined();
	fetch.mockResolvedValue(ok({ runId: "another", attachments: [] }));
	await context.refresh();
	expect(context.state.phase).toBe("failed");
});

it("cannot expose a late turn's context after navigating elsewhere", async () => {
	let shown = { dir: "/w", runId: "first", goal: "title" };
	let resolve!: (
		result: Awaited<ReturnType<MeteDaemonService["threadContextRead"]>>,
	) => void;
	const context = createSentContext({
		fetch: () => () =>
			new Promise((yes) => {
				resolve = yes;
			}),
		shown: () => shown,
		onChange: () => {},
	});
	const loading = context.show(shown);
	shown = { ...shown, runId: "second" };
	context.clear();
	resolve(
		ok({
			runId: "first",
			attachments: [
				{
					path: "private.ts",
					content: "masked",
					modified: true,
					sha256: "a".repeat(64),
				},
			],
		}),
	);
	await loading;
	expect(context.state).toEqual({ phase: "idle" });
});
