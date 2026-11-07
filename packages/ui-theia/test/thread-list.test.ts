import { type ConversationThread, err, ok } from "@mete/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createThreadList } from "../src/application/thread-list.js";
import { ConversationsSection } from "../src/application/thread-list-view.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

const id = "00000000-0000-4000-8000-000000000001";
const row: ConversationThread = {
	id,
	title: "Conversation",
	createdAt: "2026-11-07T10:00:00.000Z",
	updatedAt: "2026-11-07T10:00:00.000Z",
	turnCount: 2,
	head: {
		id,
		workspaceId: id,
		goal: "latest",
		templateId: null,
		status: "completed",
		autonomyLevel: 2,
		budget: { cloudRequests: 10, maxHours: 1 },
		createdAt: "2026-11-07T10:00:00.000Z",
	},
};

it("pages metadata once per conversation and resets cursors for search/workspace changes", async () => {
	const cursor = { updatedAt: row.updatedAt, id };
	const threadList = vi
		.fn<MeteDaemonService["threadList"]>()
		.mockResolvedValueOnce(ok({ conversations: [row], nextCursor: cursor }))
		.mockResolvedValueOnce(ok({ conversations: [row] }))
		.mockResolvedValue(ok({ conversations: [] }));
	const list = createThreadList({ fetch: threadList, onChange: () => {} });
	await list.show("/w");
	await list.more();
	expect(threadList.mock.calls[1]).toEqual(["/w", { query: "", cursor }]);
	expect(list.state.rows).toHaveLength(1);
	await list.search(" needle ");
	expect(threadList.mock.calls[2]).toEqual(["/w", { query: "needle" }]);
	await list.show("/other");
	expect(threadList.mock.calls[3]).toEqual(["/other", { query: "" }]);
});

it("ignores late pages and keeps a failed page visibly failed, never falsely empty", async () => {
	let resolve!: (
		value: Awaited<ReturnType<MeteDaemonService["threadList"]>>,
	) => void;
	const fetch = vi
		.fn<MeteDaemonService["threadList"]>()
		.mockImplementationOnce(
			() =>
				new Promise((yes) => {
					resolve = yes;
				}),
		)
		.mockResolvedValue(err({ code: "stopped", detail: "disconnected" }));
	const list = createThreadList({ fetch, onChange: () => {} });
	const first = list.show("/w");
	await list.search("other");
	resolve(ok({ conversations: [row] }));
	await first;
	const html = renderToStaticMarkup(
		ConversationsSection({
			state: list.state,
			onSearch: () => {},
			onMore: () => {},
			onRetry: () => {},
			onOpen: () => {},
			onStart: () => {},
		}),
	);
	expect(html).toContain('aria-label="Search conversations"');
	expect(html).toContain('role="alert"');
	expect(html).toContain("Retry");
	expect(html).not.toContain("No conversations");
	list.clear();
	expect(list.state.kind).toBe("no_folder");
});

it("renders a single head row with an accessible search and load-more control", () => {
	const html = renderToStaticMarkup(
		ConversationsSection({
			state: {
				kind: "ready",
				query: "",
				rows: [row],
				cursor: { id, updatedAt: row.updatedAt },
			},
			onSearch: () => {},
			onMore: () => {},
			onRetry: () => {},
			onOpen: () => {},
			onStart: () => {},
			shown: row.head.id,
		}),
	);
	expect(html.match(/class="mete-item"/g)).toHaveLength(1);
	expect(html).toContain('aria-label="Conversations"');
	expect(html).toContain("Load more");
	expect(html).not.toContain("Remove");
});
