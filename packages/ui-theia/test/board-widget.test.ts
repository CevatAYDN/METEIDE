import "reflect-metadata";
import { err, type MeteEvent, ok } from "@mete/contracts";
import { Emitter } from "@theia/core/lib/common/event";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/application/board-view.js";
import { MeteDaemonEvents } from "../src/application/daemon-events.js";
import type { TaskControlView } from "../src/application/task-control-view.js";
import { ThreadHistory } from "../src/application/thread-history-view.js";
import type { VerificationView } from "../src/application/verification-view.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";
import { MeteBoardWidget } from "../src/infrastructure/board-widget.js";
import { MeteShownRun } from "../src/infrastructure/shown-run.js";
import {
	VERIFICATION_RUN,
	verificationFixture,
} from "./verification-fixture.js";

// Only the desktop shell is replaced: navigation, reply handling and session folding are real.
vi.mock("@theia/core/lib/browser/widgets/react-widget", async () => {
	const { DisposableCollection } = await import(
		"@theia/core/lib/common/disposable.js"
	);
	return {
		ReactWidget: class {
			title = {};
			toDispose = new DisposableCollection();
			isDisposed = false;
			update() {}
			dispose() {
				this.isDisposed = true;
				this.toDispose.dispose();
			}
		},
	};
});
vi.mock("@theia/core/lib/browser/markdown-rendering/markdown-renderer", () => ({
	MarkdownRenderer: class {},
}));
vi.mock("@theia/core/lib/browser/opener-service", () => ({
	OpenerService: Symbol("OpenerService"),
	open: vi.fn(),
}));
vi.mock("@theia/core/lib/browser/theming", () => ({ ThemeService: class {} }));
vi.mock("@theia/core/lib/browser/widgets/widget", () => ({
	codicon: (name: string) => name,
}));
vi.mock("@theia/filesystem/lib/browser/file-service", () => ({
	FileService: class {},
}));
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class {},
}));
vi.mock("@theia/editor/lib/browser/editor-manager", () => ({
	EditorManager: class {},
}));
vi.mock("@theia/core/lib/browser/dialogs", () => ({ ConfirmDialog: class {} }));
vi.mock("../src/infrastructure/team-editor-contribution.js", () => ({
	EDIT_TEAM_COMMAND: { id: "mete.team.edit" },
	NEW_TEAM_COMMAND: { id: "mete.team.new" },
}));
vi.mock("../src/infrastructure/quota-contribution.js", () => ({
	OPEN_QUOTA_COMMAND: { id: "mete.quota.open" },
}));

class BoardWidget extends MeteBoardWidget {
	constructor(deps: object) {
		super();
		Object.assign(this, deps);
		this.init();
	}
	body() {
		return this.render().props.children as ReactElement<
			ComponentProps<typeof BoardView>
		>;
	}
}

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
};
const runEntry = (id: string, templateId: string | null) => ({
	id,
	templateId,
	workspaceId: "22222222-2222-4222-8222-222222222222",
	goal: "Work",
	status: "running" as const,
	autonomyLevel: 2 as const,
	budget: { cloudRequests: 10, maxHours: 1 },
	createdAt: "2026-11-08T10:00:00.000Z",
});

const setup = () => {
	let finish!: (
		value: Awaited<ReturnType<MeteDaemonService["threadReply"]>>,
	) => void;
	const pending = new Promise<
		Awaited<ReturnType<MeteDaemonService["threadReply"]>>
	>((resolve) => {
		finish = resolve;
	});
	const conversationReply = vi.fn<MeteDaemonService["threadReply"]>(
		() => pending,
	);
	const history = vi.fn<MeteDaemonService["events"]>(async () =>
		ok({ events: [], unreadable: 0 }),
	);
	const daemon = {
		verification: vi.fn<MeteDaemonService["verification"]>(async () =>
			ok(verificationFixture),
		),
		taskPending: vi.fn<MeteDaemonService["taskPending"]>(async () =>
			ok({ requests: [] }),
		),
		taskAnswer: vi.fn<MeteDaemonService["taskAnswer"]>(async () => ok(null)),
		events: history,
		status: vi.fn<MeteDaemonService["status"]>(async () => ok([])),
		transcript: async (_dir: string, runId: string) =>
			ok({ runId, conversations: [] }),
		threadReply: conversationReply,
		threadRead: vi.fn<MeteDaemonService["threadRead"]>(
			async (_dir, { runId }) => {
				const head = {
					id: runId,
					workspaceId: "workspace",
					templateId: null,
					goal: "Original title",
					status: "completed" as const,
					autonomyLevel: 2 as const,
					budget: { cloudRequests: 10, maxHours: 1 },
					createdAt: "2026-11-07T10:00:00.000Z",
				};
				return ok({
					conversation: {
						id: runId,
						title: head.goal,
						head,
						createdAt: head.createdAt,
						updatedAt: head.createdAt,
						turnCount: 1,
					},
					turns: [head],
				});
			},
		),
	};
	const shownRun = new MeteShownRun();
	const events = new MeteDaemonEvents();
	const widget = new BoardWidget({
		daemon,
		shownRun,
		events,
		workspace: {
			tryGetRoots: () => [{ resource: { path: { fsPath: () => "/w" } } }],
		},
		themes: {
			onDidColorThemeChange: new Emitter().event,
			getCurrentTheme: () => ({ type: "light" }),
		},
		messages: { warn: vi.fn() },
		composer: {
			onDidChange: new Emitter().event,
			onDidStart: new Emitter().event,
			reopen: async () => {},
			leave: () => {},
			render: () => createElement("form"),
		},
	});
	const send = (message: string) => {
		const view = widget.body();
		expect(view.type).toBe(BoardView);
		const reply = view.props.controls.onReply;
		if (!reply) throw new Error("The conversation has no reply action");
		return reply(message);
	};
	return {
		widget,
		shownRun,
		history,
		conversationReply,
		finish,
		send,
		daemon,
		events,
	};
};

describe("Board follow-up navigation", () => {
	it("wires authoritative evidence to exact notifications and rejects captured refreshes after navigation", async () => {
		const t = setup();
		t.daemon.status.mockImplementation(async (_dir, runId) =>
			ok([runEntry(runId ?? VERIFICATION_RUN, "team")]),
		);
		await t.widget.showRun("/w", VERIFICATION_RUN, "Work");
		const panel = () =>
			t.widget.body().props.controls.verification as ReactElement<
				ComponentProps<typeof VerificationView>
			>;
		await vi.waitFor(() => expect(panel().props.state.phase).toBe("ready"));
		const captured = panel();
		const event: MeteEvent = {
			id: crypto.randomUUID(),
			ts: new Date(0).toISOString(),
			schema: 1,
			workspaceId: crypto.randomUUID(),
			source: "core-engine",
			runId: VERIFICATION_RUN,
			type: "verify.updated",
			payload: {
				evaluationId: "44444444-4444-4444-8444-444444444444",
				attemptId: "33333333-3333-4333-8333-333333333333",
				index: 0,
			},
		};
		t.events.onEvent("/other", event);
		t.events.onEvent("/w", { ...event, runId: "other" });
		expect(t.daemon.verification).toHaveBeenCalledTimes(1);
		t.events.onEvent("/w", event);
		expect(t.daemon.verification).toHaveBeenCalledTimes(2);
		await t.widget.showRun("/other", VERIFICATION_RUN, "Other");
		captured.props.onRefresh();
		expect(t.daemon.verification).toHaveBeenCalledTimes(3);
		await t.widget.showRun("/w", VERIFICATION_RUN, "Work");
		captured.props.onRefresh();
		expect(t.daemon.verification).toHaveBeenCalledTimes(4);
		const latest = panel();
		await t.widget.showComposer();
		latest.props.onRefresh();
		expect(t.daemon.verification).toHaveBeenCalledTimes(4);
		t.widget.dispose();
	});
	it("waits for positive team metadata before reading verification", async () => {
		const t = setup();
		const pending =
			deferred<Awaited<ReturnType<MeteDaemonService["status"]>>>();
		t.daemon.status.mockReturnValueOnce(pending.promise);
		const opening = t.widget.showRun("/w", VERIFICATION_RUN, "Work");
		await vi.waitFor(() => expect(t.daemon.status).toHaveBeenCalledTimes(1));
		expect(t.daemon.verification).not.toHaveBeenCalled();
		pending.resolve(ok([runEntry(VERIFICATION_RUN, "team")]));
		await opening;
		expect(t.daemon.verification).toHaveBeenCalledExactlyOnceWith(
			"/w",
			VERIFICATION_RUN,
		);
		t.widget.dispose();
	});
	it("does not rebind evidence when team status arrives after disposal", async () => {
		const t = setup();
		const pending =
			deferred<Awaited<ReturnType<MeteDaemonService["status"]>>>();
		t.daemon.status.mockReturnValueOnce(pending.promise);
		const opening = t.widget.showRun("/w", VERIFICATION_RUN, "Work");
		await vi.waitFor(() => expect(t.daemon.status).toHaveBeenCalledTimes(1));
		t.widget.dispose();
		pending.resolve(ok([runEntry(VERIFICATION_RUN, "team")]));
		await opening;
		expect(t.daemon.verification).not.toHaveBeenCalled();
		expect(t.widget.body().type).toBe("form");
		expect(t.shownRun.runId).toBeUndefined();
	});
	it("does not load metadata or rebind evidence when history arrives after disposal", async () => {
		const t = setup();
		const pending =
			deferred<Awaited<ReturnType<MeteDaemonService["events"]>>>();
		t.history.mockReturnValueOnce(pending.promise);
		t.daemon.status.mockResolvedValue(ok([runEntry(VERIFICATION_RUN, "team")]));
		const opening = t.widget.showRun("/w", VERIFICATION_RUN, "Work");
		expect(t.history).toHaveBeenCalledTimes(1);
		t.widget.dispose();
		pending.resolve(ok({ events: [], unreadable: 0 }));
		await opening;
		expect(t.daemon.status).not.toHaveBeenCalled();
		expect(t.daemon.verification).not.toHaveBeenCalled();
		expect(t.daemon.threadRead).not.toHaveBeenCalled();
		expect(t.shownRun.runId).toBeUndefined();
	});
	it.each(["missing", "failed", "single"])(
		"does not read team verification for %s metadata",
		async (kind) => {
			const t = setup();
			const pending =
				deferred<Awaited<ReturnType<MeteDaemonService["status"]>>>();
			t.daemon.status.mockReturnValueOnce(pending.promise);
			const opening = t.widget.showRun("/w", VERIFICATION_RUN, "Work");
			await vi.waitFor(() => expect(t.daemon.status).toHaveBeenCalledTimes(1));
			expect(t.daemon.verification).not.toHaveBeenCalled();
			pending.resolve(
				kind === "failed"
					? err({ code: "refused", detail: "status unreadable" })
					: ok(kind === "single" ? [runEntry(VERIFICATION_RUN, null)] : []),
			);
			await opening;
			const panel = t.widget.body().props.controls.verification as ReactElement<
				ComponentProps<typeof VerificationView>
			>;
			expect(panel.props.state.phase).toBe("idle");
			expect(t.daemon.verification).not.toHaveBeenCalled();
			t.widget.dispose();
		},
	);
	it.each(["/other", "/w"])(
		"ignores delayed team metadata after selecting %s with the same run ID",
		async (dir) => {
			const t = setup();
			const pending =
				deferred<Awaited<ReturnType<MeteDaemonService["status"]>>>();
			t.daemon.status.mockReturnValueOnce(pending.promise);
			const opening = t.widget.showRun("/w", VERIFICATION_RUN, "Old");
			await vi.waitFor(() => expect(t.daemon.status).toHaveBeenCalledTimes(1));
			await t.widget.showRun(dir, VERIFICATION_RUN, "New");
			pending.resolve(ok([runEntry(VERIFICATION_RUN, "team")]));
			await opening;
			expect(t.daemon.verification).not.toHaveBeenCalled();
			expect(t.widget.body().props.controls.run.run).toBeUndefined();
			t.widget.dispose();
		},
	);
	it("refreshes historical authority for nonselected head removal and new-head events only in its workspace", async () => {
		const t = setup();
		await t.widget.showRun("/w", "old", "Original title");
		const fetch = t.daemon.threadRead;
		const previous = await fetch("/w", { runId: "old" });
		if (!previous.ok) throw new Error("Expected history fixture");
		const newHead = { ...previous.value.conversation.head, id: "new-head" };
		fetch.mockResolvedValue(
			ok({
				...previous.value,
				conversation: { ...previous.value.conversation, head: newHead },
			}),
		);
		const event: MeteEvent = {
			id: crypto.randomUUID(),
			ts: new Date().toISOString(),
			schema: 1,
			workspaceId: crypto.randomUUID(),
			source: "core-engine",
			runId: "nonselected-head",
			type: "run.removed",
			payload: {},
		};
		const before = fetch.mock.calls.length;
		t.events.onEvent("/other", event);
		expect(fetch).toHaveBeenCalledTimes(before);
		t.events.onEvent("/w", event);
		const historyView = () => {
			const fragment = t.widget.body().props.controls
				.threadHistory as ReactElement<{
				children: readonly ReactElement<ComponentProps<typeof ThreadHistory>>[];
			}>;
			return fragment.props.children.find(
				(child) => child?.type === ThreadHistory,
			);
		};
		await vi.waitFor(() =>
			expect(historyView()?.props.state.result?.conversation.head.id).toBe(
				"new-head",
			),
		);
		expect(t.shownRun.runId).toBe("old");
		t.events.onEvent("/w", {
			...event,
			id: crypto.randomUUID(),
			runId: "new-head",
			type: "run.started",
		});
		expect(fetch).toHaveBeenCalledTimes(before + 2);
		t.widget.dispose();
	});
	it("blocks the historical composer and keeps per-run history navigation", async () => {
		const t = setup();
		t.daemon.threadRead.mockImplementation(async (_dir, { runId }) => {
			const head = {
				id: "head",
				workspaceId: "workspace",
				templateId: null,
				goal: "Latest",
				status: "completed" as const,
				autonomyLevel: 2 as const,
				budget: { cloudRequests: 10, maxHours: 1 },
				createdAt: "2026-11-07T10:00:00.000Z",
			};
			return ok({
				conversation: {
					id: "old",
					title: "Original title",
					head,
					createdAt: head.createdAt,
					updatedAt: head.createdAt,
					turnCount: 2,
				},
				turns: [{ ...head, id: runId }, head],
			});
		});
		await t.widget.showRun("/w", "old", "Original title");
		expect(t.widget.body().props.controls.replyReady).toBe(false);
		expect(await t.send("No silent old-head reply")).toContain("latest");
		expect(t.conversationReply).not.toHaveBeenCalled();
		t.widget.dispose();
	});
	it("refreshes exact task events and refuses a callback captured before navigation", async () => {
		const t = setup();
		const identity = {
			runId: "11111111-1111-4111-8111-111111111111",
			taskId: "22222222-2222-4222-8222-222222222222",
			requestId: "33333333-3333-4333-8333-333333333333",
		};
		t.daemon.taskPending.mockResolvedValue(
			ok({
				requests: [
					{
						...identity,
						kind: "approval",
						templateTaskId: "write",
						title: "Write",
					},
				],
			}),
		);
		await t.widget.showRun("/w", identity.runId, "Work");
		const panel = () =>
			t.widget.body().props.controls.taskControls as ReactElement<
				ComponentProps<typeof TaskControlView>
			>;
		await vi.waitFor(() => expect(panel().props.state.phase).toBe("ready"));
		const captured = panel();
		const event: MeteEvent = {
			id: crypto.randomUUID(),
			ts: new Date(0).toISOString(),
			schema: 1,
			workspaceId: crypto.randomUUID(),
			source: "core-engine",
			runId: identity.runId,
			taskId: identity.taskId,
			type: "task.waiting",
			payload: { requestId: identity.requestId, kind: "approval" },
		};
		t.events.onEvent("/other", event);
		expect(t.daemon.taskPending).toHaveBeenCalledTimes(1);
		t.events.onEvent("/w", event);
		t.events.onEvent("/w", {
			...event,
			type: "task.wait.resolved",
		} as MeteEvent);
		expect(t.daemon.taskPending).toHaveBeenCalledTimes(3);
		await t.widget.showRun("/other", identity.runId, "Other workspace");
		await captured.props.onAnswer({ ...identity, decision: "approve" });
		expect(t.daemon.taskAnswer).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(panel().props.state.phase).toBe("ready"));
		await panel().props.onAnswer({ ...identity, decision: "approve" });
		expect(t.daemon.taskAnswer).toHaveBeenCalledWith("/other", {
			...identity,
			decision: "approve",
		});
		t.widget.dispose();
	});
	it("keeps a newly opened composer when a pending reply succeeds", async () => {
		const t = setup();
		await t.widget.showRun("/w", "old", "Original title");
		const sent = t.send("Follow up");
		await t.widget.showComposer();
		t.finish(ok({ conversationId: "old", runId: "next" }));
		await sent;
		expect(t.widget.body().type).toBe("form");
		expect(t.shownRun.runId).toBeUndefined();
		expect(t.history).toHaveBeenCalledTimes(1);
		t.widget.dispose();
	});

	it("does not navigate a disposed panel after a pending reply succeeds", async () => {
		const t = setup();
		await t.widget.showRun("/w", "old", "Original title");
		const sent = t.send("Follow up");
		t.widget.dispose();
		t.finish(ok({ conversationId: "old", runId: "next" }));
		await sent;
		expect(t.shownRun.runId).toBeUndefined();
		expect(t.history).toHaveBeenCalledTimes(1);
	});

	it("switches to the follow-up with the original title when still selected", async () => {
		const t = setup();
		await t.widget.showRun("/w", "old", "Original title");
		const sent = t.send("Follow up");
		t.finish(ok({ conversationId: "old", runId: "next" }));
		expect(await sent).toBeUndefined();
		expect(t.conversationReply).toHaveBeenCalledWith("/w", {
			conversationId: "old",
			expectedRunId: "old",
			requestId: expect.any(String),
			message: "Follow up",
		});
		expect(t.shownRun.runId).toBe("next");
		expect(t.widget.body().props.model).toMatchObject({
			kind: "board",
			goal: "Original title",
		});
		t.widget.dispose();
	});

	it("ties tool choices to the shown conversation and carries them into its reply", async () => {
		const t = setup();
		await t.widget.showRun("/w", "old", "Original title");
		const tools = t.widget.body().props.controls.tools as ReactElement<{
			capabilities: readonly string[] | undefined;
			onChange(selection: readonly string[]): void;
		}>;
		expect(tools.props.capabilities).toBeUndefined();
		tools.props.onChange(["mcp.tools@1"]);
		await t.widget.showRun("/w", "other", "Other title");
		const other = t.widget.body().props.controls.tools as typeof tools;
		expect(other.props.capabilities).toBeUndefined();
		await t.widget.showRun("/w", "old", "Original title");
		const restored = t.widget.body().props.controls.tools as typeof tools;
		expect(restored.props.capabilities).toEqual(["mcp.tools@1"]);
		const sent = t.send("Follow up");
		t.finish(ok({ conversationId: "old", runId: "next" }));
		await sent;
		expect(t.conversationReply).toHaveBeenCalledWith("/w", {
			conversationId: "old",
			expectedRunId: "old",
			requestId: expect.any(String),
			message: "Follow up",
			capabilities: ["mcp.tools@1"],
		});
		const next = t.widget.body().props.controls.tools as typeof tools;
		expect(next.props.capabilities).toEqual(["mcp.tools@1"]);
		t.widget.dispose();
	});

	it("does not replace another selection, even when it reopens the same run", async () => {
		const t = setup();
		await t.widget.showRun("/w", "old", "Original title");
		const sent = t.send("Follow up");
		await t.widget.showComposer();
		await t.widget.showRun("/w", "old", "Original title");
		t.finish(ok({ conversationId: "old", runId: "next" }));
		await sent;
		expect(t.shownRun.runId).toBe("old");
		expect(t.history).toHaveBeenCalledTimes(2);
		t.widget.dispose();
	});
});
