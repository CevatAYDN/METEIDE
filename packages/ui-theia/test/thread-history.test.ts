import { err, ok, type ThreadReadResult } from "@mete/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Shown } from "../src/application/board-session.js";
import { createThreadHistory } from "../src/application/thread-history.js";
import { ThreadHistory } from "../src/application/thread-history-view.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

const shown: Shown = { dir: "/w", runId: "old", goal: "Title" };
const head = {
	id: "head",
	workspaceId: "workspace",
	templateId: null,
	goal: "Latest",
	status: "completed",
	autonomyLevel: 2,
	budget: { cloudRequests: 10, maxHours: 1 },
	createdAt: "2026-11-07T10:00:00.000Z",
} as const;
const history: ThreadReadResult = {
	conversation: {
		id: "old",
		title: "Title",
		head,
		createdAt: head.createdAt,
		updatedAt: head.createdAt,
		turnCount: 2,
	},
	turns: [{ ...head, id: "old", goal: "First" }, head],
};

it("resolves by selected run, preserves historical selection and exposes latest separately", async () => {
	let current: Shown | undefined = shown;
	const fetch = vi.fn<MeteDaemonService["threadRead"]>(async () => ok(history));
	const session = createThreadHistory({
		fetch,
		shown: () => current,
		onChange: () => {},
	});
	await session.show(shown);
	expect(fetch).toHaveBeenCalledWith("/w", { runId: "old" });
	expect(session.state.result?.conversation.head.id).toBe("head");
	const html = renderToStaticMarkup(
		ThreadHistory({
			state: session.state,
			selected: "old",
			onOpen: () => {},
			onRetry: () => {},
			onRemove: () => {},
		}),
	);
	expect(html).toContain("Run history");
	expect(html).toContain('aria-label="Turn 1 of 2: First"');
	expect(html).toContain('aria-label="Turn 2 of 2: Latest"');
	expect(html).toContain("Return to latest");
	expect(html).toContain('aria-label="Remove run 1: First"');
	current = undefined;
	session.clear();
	expect(session.state.result).toBeUndefined();
});

it("blocks stale/failed reads and ignores late reads after navigation", async () => {
	let current: Shown | undefined = shown;
	let resolve!: (
		value: Awaited<ReturnType<MeteDaemonService["threadRead"]>>,
	) => void;
	const fetch = vi
		.fn<MeteDaemonService["threadRead"]>()
		.mockImplementationOnce(
			() =>
				new Promise((yes) => {
					resolve = yes;
				}),
		)
		.mockResolvedValue(err({ code: "refused", detail: "not found" }));
	const session = createThreadHistory({
		fetch,
		shown: () => current,
		onChange: () => {},
	});
	const pending = session.show(shown);
	current = { ...shown, dir: "/other" };
	await session.show(current);
	resolve(ok(history));
	await pending;
	expect(session.state.result).toBeUndefined();
	const html = renderToStaticMarkup(
		ThreadHistory({
			state: session.state,
			selected: "old",
			onOpen: () => {},
			onRetry: () => {},
		}),
	);
	expect(html).toContain('role="alert"');
	expect(html).toContain("Retry");
	expect(html).not.toContain("Return to latest");
});
