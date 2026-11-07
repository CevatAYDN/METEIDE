import { err, ok } from "@mete/contracts";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createThreadPanel } from "../src/application/thread-panel.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

const retryButton = (tree: ReactNode) => {
	if (!isValidElement<{ children: ReactNode }>(tree))
		throw new Error("thread controls missing");
	const button = Children.toArray(tree.props.children).find(
		(child) =>
			isValidElement<{ label?: string }>(child) &&
			child.props.label === "Retry message",
	);
	if (!isValidElement<{ onClick: () => Promise<void> }>(button))
		throw new Error("retry button missing");
	return button;
};

it.each(["success", "refused"])(
	"receipt replay button reports %s while history is read-only",
	async (outcome) => {
		const shown = { dir: "/w", runId: "old", goal: "Title" };
		const head = {
			id: "old",
			workspaceId: "workspace",
			templateId: null,
			goal: "Title",
			status: "completed" as const,
			autonomyLevel: 2 as const,
			budget: { cloudRequests: 10, maxHours: 1 },
			createdAt: "2026-11-07T10:00:00.000Z",
		};
		let latest = head;
		const threadReply = vi
			.fn<MeteDaemonService["threadReply"]>()
			.mockResolvedValueOnce(err({ code: "stopped", detail: "lost response" }))
			.mockResolvedValue(
				outcome === "success"
					? ok({ conversationId: "old", runId: "next" })
					: err({ code: "refused", detail: "The run was removed." }),
			);
		const panel = createThreadPanel({
			daemon: () => ({
				threadReply,
				threadRead: async () =>
					ok({
						conversation: {
							id: "old",
							title: "Title",
							head: latest,
							createdAt: head.createdAt,
							updatedAt: head.createdAt,
							turnCount: 2,
						},
						turns: [head, latest],
					}),
			}),
			shown: () => shown,
			show: async () => {},
			remove: () => {},
			onChange: () => {},
		});
		await panel.history.show(shown);
		await panel.controls().onReply("hello");
		latest = { ...head, id: "next" };
		await panel.history.refresh();
		expect(panel.controls().replyReady).toBe(false);
		expect(renderToStaticMarkup(panel.controls().threadHistory)).toContain(
			"Retry message",
		);
		const receipt = threadReply.mock.calls[0]?.[1];
		await retryButton(panel.controls().threadHistory).props.onClick();
		expect(threadReply.mock.calls[1]?.[1]).toEqual(receipt);
		const rendered = renderToStaticMarkup(panel.controls().threadHistory);
		expect(rendered).not.toContain("Retry message");
		if (outcome === "refused") {
			expect(rendered).toContain('role="alert"');
			expect(rendered).toContain("The run was removed.");
		}
	},
);
