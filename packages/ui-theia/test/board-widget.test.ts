import "reflect-metadata";
import { ok } from "@mete/contracts";
import { Emitter } from "@theia/core/lib/common/event";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/application/board-view.js";
import { MeteDaemonEvents } from "../src/application/daemon-events.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";
import { MeteBoardWidget } from "../src/infrastructure/board-widget.js";
import { MeteShownRun } from "../src/infrastructure/shown-run.js";

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

const setup = () => {
	let finish!: (
		value: Awaited<ReturnType<MeteDaemonService["replyRun"]>>,
	) => void;
	const pending = new Promise<
		Awaited<ReturnType<MeteDaemonService["replyRun"]>>
	>((resolve) => {
		finish = resolve;
	});
	const replyRun = vi.fn<MeteDaemonService["replyRun"]>(() => pending);
	const history = vi.fn<MeteDaemonService["events"]>(async () =>
		ok({ events: [], unreadable: 0 }),
	);
	const daemon = {
		events: history,
		status: async () => ok([]),
		transcript: async (_dir: string, runId: string) =>
			ok({ runId, conversations: [] }),
		replyRun,
	};
	const shownRun = new MeteShownRun();
	const widget = new BoardWidget({
		daemon,
		shownRun,
		events: new MeteDaemonEvents(),
		themes: {
			onDidColorThemeChange: new Emitter().event,
			getCurrentTheme: () => ({ type: "light" }),
		},
		messages: { warn: vi.fn() },
		composer: {
			onDidChange: new Emitter().event,
			onDidStart: new Emitter().event,
			reopen: async () => {},
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
	return { widget, shownRun, history, replyRun, finish, send };
};

describe("Board follow-up navigation", () => {
	it("keeps a newly opened composer when a pending reply succeeds", async () => {
		const t = setup();
		await t.widget.showRun("/w", "old", "Original title");
		const sent = t.send("Follow up");
		await t.widget.showComposer();
		t.finish(ok({ runId: "next" }));
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
		t.finish(ok({ runId: "next" }));
		await sent;
		expect(t.shownRun.runId).toBeUndefined();
		expect(t.history).toHaveBeenCalledTimes(1);
	});

	it("switches to the follow-up with the original title when still selected", async () => {
		const t = setup();
		await t.widget.showRun("/w", "old", "Original title");
		const sent = t.send("Follow up");
		t.finish(ok({ runId: "next" }));
		expect(await sent).toBeUndefined();
		expect(t.replyRun).toHaveBeenCalledWith("/w", {
			runId: "old",
			message: "Follow up",
		});
		expect(t.shownRun.runId).toBe("next");
		expect(t.widget.body().props.model).toMatchObject({
			kind: "board",
			goal: "Original title",
		});
		t.widget.dispose();
	});

	it("does not replace another selection, even when it reopens the same run", async () => {
		const t = setup();
		await t.widget.showRun("/w", "old", "Original title");
		const sent = t.send("Follow up");
		await t.widget.showComposer();
		await t.widget.showRun("/w", "old", "Original title");
		t.finish(ok({ runId: "next" }));
		await sent;
		expect(t.shownRun.runId).toBe("old");
		expect(t.history).toHaveBeenCalledTimes(2);
		t.widget.dispose();
	});
});
