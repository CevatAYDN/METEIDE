import "reflect-metadata";
import { err, ok } from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import { type ComponentProps, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	contextScope,
	createContextDrafts,
} from "../src/application/context-drafts.js";
import type { ConversationTools } from "../src/application/conversation-tools.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";
import {
	MeteRunComposer,
	type StartedRun,
} from "../src/infrastructure/run-composer.js";
import { required } from "./required-fixture.js";

vi.mock("@theia/editor/lib/browser/editor-manager", () => ({
	EditorManager: class {},
}));
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class {},
}));
vi.mock("../src/infrastructure/team-editor-contribution.js", () => ({
	EDIT_TEAM_COMMAND: { id: "mete.team.edit" },
	NEW_TEAM_COMMAND: { id: "mete.team.new" },
}));

class RunComposer extends MeteRunComposer {
	constructor(deps: object) {
		super();
		Object.assign(this, deps);
	}
	submit() {
		return this.start();
	}
}

const toolsOf = (composer: RunComposer) => {
	const tools = composer.render().props.tools;
	if (!isValidElement<ComponentProps<typeof ConversationTools>>(tools))
		throw new Error("The single-agent composer has no tools");
	return tools;
};

const setup = async (withContext = false) => {
	const drafts = createContextDrafts(() => {});
	let root: URI | undefined = URI.fromFilePath("/w");
	const threadContextStart = vi.fn<MeteDaemonService["threadContextStart"]>(
		async () => err({ code: "stopped", detail: "" }),
	);
	const notify = vi.fn(async () => {});
	const startRun = vi.fn<MeteDaemonService["startRun"]>(async () =>
		ok({ runId: "started-run" }),
	);
	const conversationStart = vi.fn<MeteDaemonService["conversationStart"]>(
		async () => ok({ runId: "started-run" }),
	);
	const threadStart = vi.fn<MeteDaemonService["threadStart"]>(async () =>
		ok({ conversationId: "thread", runId: "started-run" }),
	);
	const loads = {
		templates: vi.fn<MeteDaemonService["templates"]>(async () =>
			ok({ templates: [{ id: "review-team", name: "Review team" }] }),
		),
		changes: vi.fn<MeteDaemonService["changes"]>(async () =>
			ok({ vcs: false, branch: null, files: [] }),
		),
		quota: vi.fn<MeteDaemonService["quota"]>(async () =>
			ok({ providers: [], units: [] }),
		),
	};
	const composer = new RunComposer({
		context: withContext
			? { drafts, render: () => undefined, select: () => {} }
			: undefined,
		daemon: {
			threadContextStart,
			startRun,
			conversationStart,
			threadStart,
			...loads,
			readTemplate: async () => ok({ yaml: "roles: []\n" }),
			chain: async () => ok({ models: [] }),
			estimate: async () => ok({ providers: [], unassigned: 0 }),
			models: async () => ok({ models: [] }),
		},
		workspace: {
			get roots() {
				return Promise.resolve(root ? [{ resource: root }] : []);
			},
			tryGetRoots: () => (root ? [{ resource: root }] : []),
		},
		messages: { info: notify },
	});
	await composer.reopen();
	const send = async (goal: string) => {
		const started = new Promise<StartedRun>((resolve) => {
			const listener = composer.onDidStart((run) => {
				listener.dispose();
				resolve(run);
			});
		});
		composer.render().props.onGoal(goal);
		composer.render().props.onStart();
		return started;
	};
	return {
		composer,
		startRun,
		conversationStart,
		threadStart,
		threadContextStart,
		drafts,
		send,
		notify,
		loads,
		closeFolder: async () => {
			composer.leave();
			root = undefined;
			await composer.reopen();
		},
		navigate: async (folder: string) => {
			composer.leave();
			root = URI.fromFilePath(folder);
			drafts.select(contextScope(root.path.fsPath()));
			await composer.reopen();
		},
	};
};
const attachInitial = (drafts: ReturnType<typeof createContextDrafts>) => {
	const scope = contextScope(URI.fromFilePath("/w").path.fsPath());
	drafts.select(scope);
	drafts.complete(required(drafts.prepare(scope)), {
		sourcePath: "/w/a.ts",
		snapshot: {
			path: "a.ts",
			content: "fixed",
			modified: true,
			sha256: "a".repeat(64),
		},
	});
	return scope;
};

describe("conversation-first composer entry", () => {
	it.each([false, true])(
		"rejects retained Start after root removal and preserves its draft (context: %s)",
		async (withContext) => {
			const t = await setup(withContext);
			const scope = contextScope(URI.fromFilePath("/w").path.fsPath());
			t.drafts.select(scope);
			t.composer.render().props.onGoal("Keep the original draft");
			const start = t.composer.render().props.onStart;
			const entered = Promise.withResolvers<void>();
			const gate = Promise.withResolvers<void>();
			t.loads.templates.mockImplementationOnce(async () => {
				entered.resolve();
				await gate.promise;
				return ok({ templates: [] });
			});
			const pending = t.composer.refresh();
			await entered.promise;
			const closed = t.closeFolder();
			t.drafts.select(undefined);
			start();
			await new Promise<void>((resolve) => setImmediate(resolve));
			gate.resolve();
			await Promise.all([pending, closed]);
			expect(t.threadStart).not.toHaveBeenCalled();
			expect(t.threadContextStart).not.toHaveBeenCalled();
			expect(t.startRun).not.toHaveBeenCalled();
			if (withContext)
				expect(t.drafts.read(scope).message).toBe("Keep the original draft");
			expect(t.composer.render().props.model.kind).toBe("no_folder");
		},
	);
	it("rejects a previous Start callback after leaving and returning to the same folder", async () => {
		const t = await setup(true);
		const scope = contextScope(URI.fromFilePath("/w").path.fsPath());
		t.drafts.select(scope);
		t.composer.render().props.onGoal("Retain this draft");
		const start = t.composer.render().props.onStart;
		await t.navigate("/next");
		await t.navigate("/w");
		start();
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(t.threadStart).not.toHaveBeenCalled();
		expect(t.drafts.read(scope).message).toBe("Retain this draft");
	});
	it.each(["templates", "changes", "quota"] as const)(
		"reconciles root removal while %s is pending without publishing stale focus readiness",
		async (stage) => {
			const t = await setup();
			const entered = Promise.withResolvers<void>();
			const gate = Promise.withResolvers<void>();
			const wait = async () => {
				entered.resolve();
				await gate.promise;
			};
			if (stage === "templates")
				t.loads.templates.mockImplementationOnce(async () => {
					await wait();
					return ok({ templates: [] });
				});
			if (stage === "changes")
				t.loads.changes.mockImplementationOnce(async () => {
					await wait();
					return ok({ vcs: false, branch: null, files: [] });
				});
			if (stage === "quota")
				t.loads.quota.mockImplementationOnce(async () => {
					await wait();
					return ok({ providers: [], units: [] });
				});
			const pending = t.composer.refresh();
			await entered.promise;
			const closed = t.closeFolder();
			const focusAfterClose = t.composer.canFocusGoal();
			const readiness: boolean[] = [];
			const listener = t.composer.onDidChange(() =>
				readiness.push(t.composer.canFocusGoal()),
			);
			gate.resolve();
			await Promise.all([pending, closed]);
			listener.dispose();
			expect(t.composer.render().props.model.kind).toBe("no_folder");
			expect(t.composer.canFocusGoal()).toBe(false);
			expect(focusAfterClose).toBe(false);
			expect(readiness).not.toContain(true);
		},
	);
	it("offers no-folder recovery after the previously loaded workspace closes", async () => {
		const t = await setup();
		await t.closeFolder();
		expect(t.composer.render().props.model.kind).toBe("no_folder");
		expect(t.composer.canFocusGoal()).toBe(false);
	});
	it("routes the no-folder recovery action to Theia without starting a daemon", async () => {
		const executeCommand = vi.fn(async () => {});
		const templates = vi.fn();
		const composer = new RunComposer({
			workspace: { roots: Promise.resolve([]), tryGetRoots: () => [] },
			commands: { executeCommand },
			daemon: { templates },
		});
		await composer.reopen();
		expect(composer.render().props.model.kind).toBe("no_folder");
		composer.render().props.onOpenFolder();
		expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
			"workspace:openFolder",
		);
		expect(templates).not.toHaveBeenCalled();
	});
	it("retains the entire initial uncertain request across workspace navigation until an explicit settings edit", async () => {
		const t = await setup(true);
		attachInitial(t.drafts);
		t.composer.render().props.onGoal("Keep original");
		required(t.composer.render().props.onSingleModel)("provider/model");
		toolsOf(t.composer).props.onChange(["mcp.tools@1"]);
		await t.composer.submit();
		const original = t.threadContextStart.mock.calls[0]?.[1];
		expect(original).toMatchObject({
			prefer: { providerId: "provider", modelId: "model" },
			capabilities: ["mcp.tools@1"],
		});
		await t.navigate("/other");
		t.composer.render().props.onGoal("Other workspace");
		await t.navigate("/w");
		expect(t.composer.render().props.goal).toBe("Keep original");
		expect(t.composer.render().props.singleModel).toBe("provider/model");
		expect(toolsOf(t.composer).props.capabilities).toEqual(["mcp.tools@1"]);
		await t.composer.submit();
		expect(t.threadContextStart.mock.calls[1]?.[1]).toEqual(original);
		toolsOf(t.composer).props.onChange(["web.search@1"]);
		await t.composer.submit();
		expect(t.threadContextStart.mock.calls[2]?.[1].requestId).not.toBe(
			original?.requestId,
		);
		expect(t.threadContextStart.mock.calls[2]?.[1].capabilities).toEqual([
			"web.search@1",
		]);
	});

	it("renders the successful scope empty after returning to an initial composer while its send is pending", async () => {
		const t = await setup(true);
		const scope = attachInitial(t.drafts);
		const other = contextScope(URI.fromFilePath("/other").path.fsPath());
		t.drafts.message(other, "Keep other draft");
		t.composer.render().props.onGoal("Sent once");
		let resolve!: (
			value: Awaited<ReturnType<MeteDaemonService["threadContextStart"]>>,
		) => void;
		t.threadContextStart.mockImplementation(
			() =>
				new Promise((yes) => {
					resolve = yes;
				}),
		);
		const started = vi.fn();
		t.composer.onDidStart(started);
		const pending = t.composer.submit();
		t.composer.leave();
		await t.composer.reopen();
		expect(t.composer.render().props.goal).toBe("Sent once");
		resolve(ok({ conversationId: "thread", runId: "sent" }));
		await pending;
		expect(started).not.toHaveBeenCalled();
		expect(t.composer.render().props.goal).toBe("");
		expect(t.drafts.read(scope).attachments).toEqual([]);
		expect(t.drafts.read(other).message).toBe("Keep other draft");
		await t.composer.submit();
		expect(t.threadContextStart).toHaveBeenCalledOnce();
	});
	it("reuses the initial request after an overflowed attachment leaves its payload unchanged", async () => {
		const t = await setup(true);
		const scope = contextScope(URI.fromFilePath("/w").path.fsPath());
		t.drafts.select(scope);
		const attach = () =>
			t.drafts.complete(required(t.drafts.prepare(scope)), {
				sourcePath: "/w/a.ts",
				snapshot: {
					path: "a.ts",
					content: "fixed",
					modified: true,
					sha256: "a".repeat(64),
				},
			});
		for (let index = 0; index < 4; index++) attach();
		t.composer.render().props.onGoal("Keep this request");
		await t.composer.submit();
		const receipt = t.threadContextStart.mock.calls[0]?.[1];
		expect(attach()).toBe(false);
		const original = required(t.drafts.read(scope).attachments[0]);
		t.drafts.complete(required(t.drafts.prepare(scope, original.id)), original);
		await t.composer.submit();
		expect(t.threadContextStart.mock.calls[1]?.[1]).toEqual(receipt);
	});
	it("keeps initial context on uncertain retry and refuses to silently send it with a team", async () => {
		const t = await setup(true);
		const { drafts, threadContextStart } = t;
		const scope = contextScope(URI.fromFilePath("/w").path.fsPath());
		drafts.select(scope);
		drafts.complete(required(drafts.prepare(scope)), {
			sourcePath: "/w/a.ts",
			snapshot: {
				path: "a.ts",
				content: "fixed masked copy",
				modified: true,
				sha256: "a".repeat(64),
			},
		});
		t.composer.render().props.onGoal("Keep authored text");
		await t.composer.submit();
		await t.composer.submit();
		expect(threadContextStart.mock.calls[1]?.[1]).toEqual(
			threadContextStart.mock.calls[0]?.[1],
		);
		expect(drafts.read(scope).message).toBe("Keep authored text");
		expect(drafts.read(scope).attachments[0]?.snapshot.content).toBe(
			"fixed masked copy",
		);
		t.composer.render().props.onSelect("review-team");
		await t.composer.submit();
		expect(t.startRun).not.toHaveBeenCalled();
		expect(t.composer.render().props.error).toContain("single-agent");
		expect(drafts.read(scope).attachments).toHaveLength(1);
	});
	it("does not navigate on a late start after leaving the composer", async () => {
		const t = await setup();
		let resolve!: (
			value: Awaited<ReturnType<MeteDaemonService["threadStart"]>>,
		) => void;
		t.threadStart.mockImplementation(
			() =>
				new Promise((yes) => {
					resolve = yes;
				}),
		);
		const started = vi.fn();
		t.composer.onDidStart(started);
		t.composer.render().props.onGoal("hello");
		const pending = t.composer.submit();
		t.composer.leave();
		resolve(ok({ conversationId: "thread", runId: "late" }));
		await pending;
		expect(started).not.toHaveBeenCalled();
	});
	it("retries an uncertain start with its id, but retires it on a draft edit", async () => {
		const t = await setup();
		t.threadStart.mockResolvedValue(
			err({ code: "stopped", detail: "receipt unknown" }),
		);
		t.composer.render().props.onGoal("hello");
		await t.composer.submit();
		await t.composer.submit();
		expect(t.threadStart.mock.calls[1]?.[1]).toEqual(
			t.threadStart.mock.calls[0]?.[1],
		);
		t.composer.render().props.onGoal("edited");
		await t.composer.submit();
		expect(t.threadStart.mock.calls[2]?.[1].requestId).not.toBe(
			t.threadStart.mock.calls[0]?.[1].requestId,
		);
		expect(t.composer.render().props.goal).toBe("edited");
		expect(t.conversationStart).not.toHaveBeenCalled();
	});
	it("starts a single agent both initially and after a successful start and reopen", async () => {
		const t = await setup();
		expect(t.composer.render().props.selected).toBe("single");
		expect(await t.send("Hello")).toMatchObject({ goal: "Hello" });
		await t.composer.reopen();
		expect(t.composer.render().props.selected).toBe("single");
		expect(t.composer.render().props.goal).toBe("");
		await t.send("Another conversation");
		expect(t.threadStart.mock.calls.map(([, request]) => request)).toEqual([
			{ goal: "Hello", capabilities: [], requestId: expect.any(String) },
			{
				goal: "Another conversation",
				capabilities: [],
				requestId: expect.any(String),
			},
		]);
		expect(t.threadStart.mock.calls[0]?.[1].requestId).not.toBe(
			t.threadStart.mock.calls[1]?.[1].requestId,
		);
		expect(t.conversationStart).not.toHaveBeenCalled();
		expect(t.startRun).not.toHaveBeenCalled();
		expect(t.notify).not.toHaveBeenCalled();
	});

	it("sends selected groups only for single agents and resets them for the next conversation", async () => {
		const t = await setup();
		const tools = toolsOf(t.composer);
		tools.props.onChange(["web.search@1", "web.fetch@1", "mcp.tools@1"]);
		t.composer.render().props.onGoal("Keep my draft");
		toolsOf(t.composer).props.onChange(["mcp.tools@1"]);
		expect(t.composer.render().props.goal).toBe("Keep my draft");
		const started = await t.send("Use tools");
		expect(started).toMatchObject({ capabilities: ["mcp.tools@1"] });
		expect(t.threadStart).toHaveBeenLastCalledWith(
			URI.fromFilePath("/w").path.fsPath(),
			{
				goal: "Use tools",
				capabilities: ["mcp.tools@1"],
				requestId: expect.any(String),
			},
		);
		expect(toolsOf(t.composer).props.capabilities).toEqual([]);
		t.composer.render().props.onSelect("review-team");
		expect(t.composer.render().props.tools).toBeUndefined();
	});

	it("keeps an explicit team choice across reopen, then defaults the next run to single", async () => {
		const t = await setup();
		t.composer.render().props.onSelect("review-team");
		await t.composer.reopen();
		expect(t.composer.render().props.selected).toBe("review-team");
		await t.send("Review this");
		expect(t.startRun).toHaveBeenLastCalledWith(
			URI.fromFilePath("/w").path.fsPath(),
			{ goal: "Review this", templateId: "review-team" },
		);
		await t.composer.reopen();
		expect(t.composer.render().props.selected).toBe("single");
		t.composer.render().props.onSelect("review-team");
		await t.send("Review again");
		expect(t.startRun.mock.calls[1]?.[1]).toEqual({
			goal: "Review again",
			templateId: "review-team",
		});
	});

	it("still lets an explicit router choice omit the template", async () => {
		const t = await setup();
		t.composer.render().props.onSelect("choose");
		await t.composer.reopen();
		await t.send("Choose for me");
		expect(t.startRun.mock.calls[0]?.[1]).toEqual({ goal: "Choose for me" });
	});
});
