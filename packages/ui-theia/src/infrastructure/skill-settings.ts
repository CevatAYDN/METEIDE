import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { SkillSession } from "../application/skill-session.js";
import type { SkillManagementService } from "../domain/skill-management.js";
import { openSkillEditor } from "./skill-editor.js";

type Editor = {
	readonly files: Pick<FileService, "resolve" | "watch" | "onDidFilesChange">;
	readonly globalFile: () => string | undefined;
	readonly open: (uri: URI) => Promise<unknown>;
};
type Watches = Map<string, { uri: URI; dispose(): void }>;

type Deps = {
	readonly api: SkillManagementService;
	readonly dir: () => Promise<string>;
	readonly listen: (changed: () => void) => { dispose(): void };
	readonly changed: () => void;
	readonly editor?: Editor;
};

const watchForOpen = (editor: Editor, watches: Watches, uri: URI) => {
	const key = uri.toString();
	const existing = watches.get(key);
	const watcher = existing ? undefined : editor.files.watch(uri);
	const own = watcher ? { uri, dispose: () => watcher.dispose() } : undefined;
	if (own) watches.set(key, own);
	return { key, own };
};

const watchedOpen =
	(editor: Editor, watches: Watches, current: () => boolean) =>
	async (uri: URI) => {
		const { key, own } = watchForOpen(editor, watches, uri);
		let failed = true;
		try {
			const result = await editor.open(uri);
			failed = false;
			return result;
		} finally {
			if (own && (failed || !current()) && watches.get(key) === own) {
				watches.delete(key);
				own.dispose();
			}
		}
	};

const editorOpening =
	(editor: Editor, watches: Watches) =>
	(
		source: Parameters<typeof openSkillEditor>[0]["source"],
		current: () => boolean,
		dir: string,
	) => {
		const globalFile = editor.globalFile();
		return openSkillEditor({
			source,
			workspace: URI.fromFilePath(dir),
			current,
			...(globalFile
				? { globalFile: URI.fromFilePath(globalFile).toString() }
				: {}),
			resolve: (uri) => editor.files.resolve(uri),
			open: watchedOpen(editor, watches, current),
		});
	};

/** Invalidate synchronously on root notifications before asynchronous root resolution. */
export const createSkillSettings = (deps: Deps) => {
	const watches: Watches = new Map();
	const clearWatches = () => {
		for (const watch of watches.values()) watch.dispose();
		watches.clear();
	};
	const session = new SkillSession({
		api: deps.api,
		changed: deps.changed,
		now: Date.now,
		...(deps.editor ? { open: editorOpening(deps.editor, watches) } : {}),
	});
	let generation = 0;
	const sync = async () => {
		const revision = ++generation;
		clearWatches();
		session.workspace(undefined);
		const dir = await deps.dir();
		if (revision === generation) session.workspace(dir || undefined);
	};
	const listener = deps.listen(() => void sync());
	const fileListener = deps.editor?.files.onDidFilesChange((event) => {
		if ([...watches.values()].some(({ uri }) => event.contains(uri)))
			void session.sourceChanged();
	});
	void sync();
	return {
		view: () => session.view(),
		reconnect: () => session.reconnect(),
		dispose: () => {
			generation++;
			listener.dispose();
			fileListener?.dispose();
			clearWatches();
			session.workspace(undefined);
		},
	};
};
