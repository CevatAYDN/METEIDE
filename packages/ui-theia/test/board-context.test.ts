import "reflect-metadata";
import { err, ok, type ThreadReadResult } from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import { expect, it, vi } from "vitest";
import { contextScope } from "../src/application/context-drafts.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";
import { createBoardContext } from "../src/infrastructure/board-context.js";
import { MeteEditorContext } from "../src/infrastructure/editor-context-service.js";
import { required } from "./required-fixture.js";

vi.mock("@theia/editor/lib/browser/editor-manager", () => ({
	EditorManager: class {},
}));
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class {},
}));

class Context extends MeteEditorContext {
	constructor(deps: object) {
		super();
		Object.assign(this, deps);
	}
}
const history = (headId = "turn-2"): ThreadReadResult => {
	const head = {
		id: headId,
		workspaceId: "workspace",
		templateId: null,
		goal: "Title",
		status: "completed" as const,
		autonomyLevel: 2 as const,
		budget: { cloudRequests: 10, maxHours: 1 },
		createdAt: "2026-11-07T10:00:00.000Z",
	};
	return {
		conversation: {
			id: "thread",
			title: "Title",
			head,
			createdAt: head.createdAt,
			updatedAt: head.createdAt,
			turnCount: 2,
		},
		turns: [{ ...head, id: "turn-1" }, head],
	};
};
const setup = () => {
	const root = URI.fromFilePath("/w");
	const dir = root.path.fsPath();
	let shown = { dir, runId: "turn-2", goal: "Title" };
	let text = "one";
	const getText = vi.fn(() => text);
	const editor = {
		uri: URI.fromFilePath("/w/a.ts"),
		selection: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 3 },
		},
		document: { dirty: true, getText, toValidRange: (range: object) => range },
	};
	const daemon = {
		threadRead: vi.fn<MeteDaemonService["threadRead"]>(async () =>
			ok(history()),
		),
		threadReply: vi.fn<MeteDaemonService["threadReply"]>(async () =>
			ok({ conversationId: "thread", runId: "turn-3" }),
		),
		threadContextRead: vi.fn<MeteDaemonService["threadContextRead"]>(
			async (_dir, input) => ok({ runId: input.runId, attachments: [] }),
		),
		threadContextPrepare: vi.fn<MeteDaemonService["threadContextPrepare"]>(
			async (_dir, input) =>
				ok({ ...input, path: "a.ts", sha256: "a".repeat(64) }),
		),
	};
	const context = new Context({
		editors: { currentEditor: { editor }, all: [{ editor }] },
		workspace: { tryGetRoots: () => [{ resource: root }] },
		daemon,
	});
	const board = createBoardContext({
		daemon: () => daemon,
		context: () => context,
		shown: () => shown,
		currentDir: () => dir,
		disposed: () => false,
		leave: () => {},
		show: async () => {},
		remove: () => {},
		onChange: () => {},
	});
	const navigate = async (runId: string) => {
		board.clear();
		shown = { ...shown, runId };
		await board.history.show(shown);
		board.selectRun(shown);
	};
	const controls = () => {
		const view = board.controls().attachments;
		if (!view) throw new Error("Expected resolved attachment controls");
		return view.props;
	};
	return {
		board,
		context,
		daemon,
		dir,
		getText,
		navigate,
		controls,
		edit: (value: string) => {
			text = value;
		},
	};
};

it("keeps an unresolved later turn read-only and binds all attachment actions after history Retry resolves its conversation", async () => {
	const t = setup();
	t.daemon.threadRead.mockResolvedValueOnce(
		err({ code: "stopped", detail: "" }),
	);
	await t.navigate("turn-2");
	expect(t.board.controls().conversationKey).toBeUndefined();
	expect(t.board.controls().attachments).toBeUndefined();
	expect(t.context.canAttach()).toBe(false);
	await t.context.add("file");
	expect(t.daemon.threadContextPrepare).not.toHaveBeenCalled();
	await t.board.history.refresh();
	const scope = contextScope(t.dir, "thread");
	expect(t.context.currentTarget?.scope).toBe(scope);
	expect(t.context.canAttach()).toBe(true);
	t.controls().onAdd("selection");
	await vi.waitFor(() => expect(t.controls().items).toHaveLength(1));
	t.edit("two");
	t.controls().onUpdate(required(t.controls().items[0]).id);
	await vi.waitFor(() =>
		expect(t.controls().items[0]?.snapshot.content).toBe("two"),
	);
	t.controls().onRemove(required(t.controls().items[0]).id);
	expect(t.context.drafts.read(scope).attachments).toEqual([]);
	expect(
		t.context.drafts.read(contextScope(t.dir, "turn-2")).attachments,
	).toEqual([]);
});

it("refuses native and retained edit callbacks on a historical turn without mutating the latest shared draft", async () => {
	const t = setup();
	await t.navigate("turn-2");
	await t.context.add("file");
	const editable = t.controls();
	const item = required(editable.items[0]);
	const scope = contextScope(t.dir, "thread");
	const original = t.context.drafts.read(scope);
	await t.navigate("turn-1");
	expect(t.board.controls().replyReady).toBe(false);
	expect(t.context.canAttach()).toBe(false);
	expect(t.controls().busy).toBe(false);
	expect(t.controls().disabled).toBe(true);
	const reads = t.getText.mock.calls.length;
	await t.context.add("file");
	await t.context.update(scope, item.id);
	expect(
		await t.context.prepareCaptured(scope, {
			path: "/w/a.ts",
			content: "other",
			modified: true,
		}),
	).toBe(false);
	editable.onRemove(item.id);
	t.controls().onRemove(item.id);
	expect(t.getText).toHaveBeenCalledTimes(reads);
	expect(t.daemon.threadContextPrepare).toHaveBeenCalledOnce();
	expect(t.context.drafts.read(scope)).toEqual(original);
	await t.navigate("turn-2");
	expect(t.context.canAttach()).toBe(true);
	expect(t.controls().items).toHaveLength(1);
});

it("retires prepare authority when a history refresh reveals a newer head", async () => {
	const t = setup();
	await t.navigate("turn-2");
	const scope = contextScope(t.dir, "thread");
	let finish!: (
		result: Awaited<ReturnType<MeteDaemonService["threadContextPrepare"]>>,
	) => void;
	t.daemon.threadContextPrepare.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const preparing = t.context.add("file");
	t.daemon.threadRead.mockResolvedValue(ok(history("turn-3")));
	await t.board.history.refresh();
	expect(t.context.canAttach()).toBe(false);
	finish(
		ok({
			path: "a.ts",
			content: "one",
			modified: true,
			sha256: "a".repeat(64),
		}),
	);
	await preparing;
	expect(t.context.drafts.read(scope).attachments).toEqual([]);
	expect(t.context.drafts.read(scope).revision).toBe(0);
	expect(t.context.drafts.read(scope).busy).toBe(false);
});
