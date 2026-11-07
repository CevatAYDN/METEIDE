import "reflect-metadata";
import {
	type ContextDraft,
	type ContextSnapshot,
	ok,
	type Result,
} from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import { expect, it, vi } from "vitest";
import { contextScope } from "../src/application/context-drafts.js";
import type { DaemonFailure } from "../src/domain/status-service.js";
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
const range = {
	start: { line: 0, character: 0 },
	end: { line: 0, character: 3 },
};
const dir = URI.fromFilePath("/w").path.fsPath();
const setup = () => {
	let text = "one";
	const editor = {
		uri: URI.fromFilePath("/w/a.ts"),
		selection: range,
		document: {
			dirty: true,
			getText: () => text,
			toValidRange: (value: typeof range) => value,
		},
	};
	const editors = {
		currentEditor: { editor },
		activeEditor: undefined,
		all: [{ editor }],
	};
	const prepare = vi.fn(
		async (
			_dir: string,
			input: ContextDraft,
		): Promise<Result<ContextSnapshot, DaemonFailure>> =>
			ok({ ...input, path: "a.ts", sha256: "a".repeat(64) }),
	);
	const context = new Context({
		editors,
		workspace: { tryGetRoots: () => [{ resource: URI.fromFilePath("/w") }] },
		daemon: { threadContextPrepare: prepare },
	});
	context.select(dir, "thread");
	return {
		context,
		editors,
		prepare,
		edit: (value: string) => {
			text = value;
		},
	};
};

it("captures before the prepare await despite menu focus loss and updates its original source/range", async () => {
	const t = setup();
	const scope = contextScope(dir, "thread");
	await t.context.add("selection");
	t.edit("two");
	t.editors.currentEditor = {
		editor: {
			...t.editors.currentEditor.editor,
			uri: URI.fromFilePath("/w/other.ts"),
		},
	};
	await t.context.update(
		scope,
		required(t.context.drafts.read(scope).attachments[0]).id,
	);
	expect(t.prepare.mock.calls[1]?.[1]).toMatchObject({
		content: "two",
		path: URI.fromFilePath("/w/a.ts").path.fsPath(),
		range,
	});
	t.editors.all = [];
	await t.context.update(
		scope,
		required(t.context.drafts.read(scope).attachments[0]).id,
	);
	expect(t.context.drafts.read(scope).attachments[0]?.snapshot.content).toBe(
		"two",
	);
	expect(t.context.drafts.read(scope).error).toContain("unavailable");
});

it("never attaches a late result after changing conversation even if navigation returns", async () => {
	const t = setup();
	let resolve!: (result: Result<ContextSnapshot, DaemonFailure>) => void;
	t.prepare.mockImplementation(
		() =>
			new Promise((yes) => {
				resolve = yes;
			}),
	);
	const pending = t.context.add("file");
	t.edit("later");
	expect(t.prepare.mock.calls[0]?.[1].content).toBe("one");
	t.context.select(dir, "other");
	t.context.select(dir, "thread");
	resolve(
		ok({
			path: "a.ts",
			content: "one",
			modified: true,
			sha256: "a".repeat(64),
		}),
	);
	await pending;
	expect(
		t.context.drafts.read(contextScope(dir, "thread")).attachments,
	).toEqual([]);
});

it("enables explicit native capture with no composer target without reading the editor", () => {
	const t = setup();
	t.context.select();
	const getText = vi.spyOn(t.editors.currentEditor.editor.document, "getText");
	expect(t.context.canAttach()).toBe(true);
	expect(getText).not.toHaveBeenCalled();
	expect(t.context.capture("selection")).toMatchObject({
		ok: true,
		value: { content: "one", range },
	});
	expect(t.context.currentTarget).toBeUndefined();
});
