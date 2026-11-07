import type { ContextDraft } from "@mete/contracts";
import { Emitter } from "@theia/core/lib/common/event";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import { inject, injectable } from "@theia/core/shared/inversify";
import { EditorManager } from "@theia/editor/lib/browser/editor-manager";
import { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { ContextAttachments } from "../application/context-attachments-view.js";
import {
	type ContextTarget,
	contextScope,
	createContextDrafts,
} from "../application/context-drafts.js";
import { captureEditorContext } from "../application/editor-context.js";
import { MeteDaemonService } from "../domain/status-service.js";
import "../../style/mete-context.css";

const unavailable = () =>
	nls.localize(
		"mete/context/unavailable",
		"Editor context is unavailable. The previous attachments are kept.",
	);
const failed = () =>
	nls.localize(
		"mete/context/failed",
		"Could not prepare the attachment. Check the source and limits, then try again; previous attachments are kept.",
	);

/** Explicit editor access, scoped preparation and shared transient draft ownership (ADR-183). */
@injectable()
export class MeteEditorContext {
	@inject(EditorManager) protected readonly editors!: EditorManager;
	@inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
	@inject(MeteDaemonService) protected readonly daemon!: MeteDaemonService;
	protected readonly changed = new Emitter<void>();
	readonly onDidChange = this.changed.event;
	readonly drafts = createContextDrafts(() => this.changed.fire());
	private target: ContextTarget | undefined;
	private editable = true;
	get currentTarget(): ContextTarget | undefined {
		return this.target;
	}
	get workspaceDir(): string | undefined {
		return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
	}
	/** Native commands capture before they create or reveal any composer. */
	capture(mode: "file" | "selection") {
		return captureEditorContext(this.editors.currentEditor?.editor, mode);
	}

	/** Called by panel navigation, without reading or saving any editor text. */
	select(dir?: string, conversationId?: string, editable = true): void {
		const scope = dir ? contextScope(dir, conversationId) : undefined;
		if (this.target?.scope === scope && this.editable === editable) return;
		this.editable = editable;
		this.target = dir && scope ? { dir, scope } : undefined;
		this.drafts.select(editable ? scope : undefined);
	}
	private current(scope: string) {
		const target = this.target;
		return this.editable &&
			target?.scope === scope &&
			this.workspaceDir === target.dir
			? target
			: undefined;
	}
	/** Menu enablement does not read the buffer or initiate preparation. */
	canAttach(): boolean {
		if (!this.editable) return false;
		const dir = this.workspaceDir;
		const scope = this.target?.scope;
		return (
			!!dir &&
			!!this.editors.currentEditor &&
			!this.drafts.read(scope ?? contextScope(dir)).busy &&
			(!scope || !!this.current(scope))
		);
	}
	/** Capture is synchronous up to the first prepare request, even when menus stole focus. */
	add(mode: "file" | "selection", scope = this.target?.scope): Promise<void> {
		if (!scope || !this.current(scope) || this.drafts.read(scope).busy)
			return Promise.resolve();
		const capture = this.capture(mode);
		if (!capture.ok) {
			this.drafts.error(scope, unavailable());
			return Promise.resolve();
		}
		return this.prepareCaptured(scope, capture.value).then(() => {});
	}
	/** Already captured content is prepared without consulting the active editor again. */
	prepareCaptured(scope: string, input: ContextDraft): Promise<boolean> {
		return this.prepare(scope, input);
	}
	/** Update never opens a closed source or substitutes the currently active editor. */
	update(scope: string, id: string): Promise<void> {
		const item = this.drafts
			.read(scope)
			.attachments.find((entry) => entry.id === id);
		if (!item || !this.current(scope) || this.drafts.read(scope).busy)
			return Promise.resolve();
		const uri = URI.fromFilePath(item.sourcePath).toString();
		const editor = this.editors.all.find(
			(widget) => widget.editor.uri.toString() === uri,
		);
		const capture = captureEditorContext(
			editor?.editor,
			"file",
			item.snapshot.range,
		);
		if (!capture.ok) {
			this.drafts.error(scope, unavailable());
			return Promise.resolve();
		}
		return this.prepare(scope, capture.value, id).then(() => {});
	}
	private async prepare(
		scope: string,
		input: ContextDraft,
		id?: string,
	): Promise<boolean> {
		const target = this.current(scope);
		if (!target) return false;
		const ticket = this.drafts.prepare(scope, id);
		if (!ticket) return false;
		try {
			const result = await this.daemon.threadContextPrepare(target.dir, input);
			return this.drafts.complete(
				ticket,
				result.ok && this.current(scope) === target
					? { snapshot: result.value, sourcePath: input.path }
					: undefined,
				failed(),
			);
		} catch {
			this.drafts.complete(ticket, undefined, failed());
			return false;
		}
	}
	/** The same scoped draft is exposed in the initial and reply composers. */
	render(scope: string, disabled = false) {
		const draft = this.drafts.read(scope);
		const owner = this.current(scope);
		const editable = () =>
			!disabled && !!owner && this.current(scope) === owner;
		return (
			<ContextAttachments
				items={draft.attachments}
				busy={draft.busy}
				disabled={disabled || !owner}
				error={draft.error}
				onAdd={(mode) => {
					if (editable()) void this.add(mode, scope);
				}}
				onRemove={(id) => {
					if (editable()) this.drafts.remove(scope, id);
				}}
				onUpdate={(id) => {
					if (editable()) void this.update(scope, id);
				}}
			/>
		);
	}
}
