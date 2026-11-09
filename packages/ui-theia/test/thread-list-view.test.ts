import type { ConversationThread } from "@mete/contracts";
import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ThreadListState } from "../src/application/thread-list.js";
import { ConversationsSection } from "../src/application/thread-list-view.js";

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
const ready: ThreadListState = { kind: "ready", query: "", rows: [] };
const failure: NonNullable<ThreadListState["failure"]> = {
	code: "stopped",
	detail: "disconnected",
};
const none = () => {};
const view = (
	state: ThreadListState,
	actions: Partial<Parameters<typeof ConversationsSection>[0]> = {},
) =>
	ConversationsSection({
		state,
		onSearch: none,
		onMore: none,
		onRetry: none,
		onOpen: none,
		onStart: none,
		...actions,
	});
const html = (state: ThreadListState) => renderToStaticMarkup(view(state));

type Clickable = { children?: ReactNode; onClick?: () => void };
// Expand stateless views as the Home tests do to exercise native button callbacks.
const buttons = (node: ReactNode): ReactElement<Clickable>[] =>
	Children.toArray(node).flatMap((child) => {
		if (!isValidElement<Clickable>(child)) return [];
		if (typeof child.type === "function")
			return buttons(
				(child.type as (props: unknown) => ReactNode)(child.props),
			);
		return child.type === "button" ? [child] : buttons(child.props.children);
	});

it.each(["", " ", "\t\n "])(
	"shows first-use copy for a successful empty list with query %j",
	(query) => {
		const out = html({ ...ready, query });
		expect(out).toContain("No conversations yet.");
		expect(out).not.toContain("No conversations match this search.");
		expect(out).toContain("New run");
		expect(out).not.toContain("Retry");
	},
);

it.each(["needle", " needle "])(
	"keeps search-result copy for a successful empty list with query %j",
	(query) => {
		const out = html({ ...ready, query });
		expect(out).toContain("No conversations match this search.");
		expect(out).not.toContain("No conversations yet.");
		expect(out).toContain("New run");
	},
);

it.each(["", " \t ", "needle"])(
	"shows populated rows without either empty notice for query %j",
	(query) => {
		const out = html({ ...ready, query, rows: [row] });
		expect(out.match(/class="mete-item"/g)).toHaveLength(1);
		expect(out).toContain('title="Conversation"');
		expect(out).not.toContain("No conversations");
	},
);

it.each(["", " \t ", "needle"])(
	"keeps loading distinct from an empty success for query %j",
	(query) => {
		const out = html({ ...ready, kind: "loading", query });
		expect(out).toContain('role="status"');
		expect(out).toContain("Reading conversations");
		expect(out).not.toContain("No conversations");
		expect(out).not.toContain("Retry");
	},
);

it.each(["failed", "ready"] as const)(
	"never asserts empty success when a %s state carries a failure",
	(kind) => {
		for (const query of ["", " \t ", "needle"]) {
			const out = html({ ...ready, kind, query, failure });
			expect(out).toContain('role="alert"');
			expect(out).toContain("The METE daemon stopped: disconnected");
			expect(out).toContain("Retry");
			expect(out).not.toContain("No conversations");
		}
	},
);

it("does not infer empty success from a failed state without failure details", () => {
	expect(html({ ...ready, kind: "failed" })).not.toContain("No conversations");
});

it("retains rows and the retry notice after a failed read", () => {
	const out = html({ ...ready, kind: "failed", rows: [row], failure });
	expect(out).toContain('title="Conversation"');
	expect(out).toContain('role="alert"');
	expect(out).toContain("Retry");
	expect(out).not.toContain("No conversations");
});

it("keeps the folder prerequisite and disabled search without empty-success copy", () => {
	const out = html({ ...ready, kind: "no_folder" });
	expect(out).toContain(
		"Open a folder first: METE works on one folder at a time.",
	);
	expect(out).toContain('aria-label="Search conversations"');
	expect(out).toContain('disabled=""');
	expect(out).not.toContain("No conversations");
	expect(out).not.toContain("Retry");
});

it.each(["ready", "loading", "failed", "no_folder"] as const)(
	"preserves the existing New run callback in the %s state",
	(kind) => {
		const onStart = vi.fn();
		const onRetry = vi.fn();
		const tree = view(
			{ ...ready, kind, ...(kind === "failed" ? { failure } : {}) },
			{ onStart, onRetry },
		);
		const start = buttons(tree).find((button) =>
			renderToStaticMarkup(button).includes("New run"),
		);
		expect(start).toBeDefined();
		start?.props.onClick?.();
		expect(onStart).toHaveBeenCalledOnce();
		expect(onRetry).not.toHaveBeenCalled();
	},
);

it("preserves Retry as a separate failure action without starting a run", () => {
	const onStart = vi.fn();
	const onRetry = vi.fn();
	const tree = view(
		{ ...ready, kind: "failed", failure },
		{ onStart, onRetry },
	);
	const retry = buttons(tree).find((button) =>
		renderToStaticMarkup(button).includes("Retry"),
	);
	expect(retry).toBeDefined();
	retry?.props.onClick?.();
	expect(onRetry).toHaveBeenCalledOnce();
	expect(onStart).not.toHaveBeenCalled();
});
