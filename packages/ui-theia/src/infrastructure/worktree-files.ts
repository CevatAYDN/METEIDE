import type { MessageService } from "@theia/core";
import {
	type OpenerService,
	open,
} from "@theia/core/lib/browser/opener-service";
import type { StatefulWidget } from "@theia/core/lib/browser/shell/shell-layout-restorer";
import { nls } from "@theia/core/lib/common/nls";
import type { QuickInputService } from "@theia/core/lib/common/quick-pick-service";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { hidden, isPage, ranked } from "../application/worktree-files.js";

// The files under a task's worktree for the card's "Show files" (ADR-132).
// shortcut: five folders deep and 200 files; a task's own work is far smaller, raise it when a team writes more.
const DEPTH = 5;
const MAX = 200;

/** The files under `dir`, as paths relative to it, pages first. */
export const worktreeFiles = async (
	files: FileService,
	dir: URI,
): Promise<string[]> => {
	const walk = async (
		folder: URI,
		prefix: string,
		depth: number,
	): Promise<string[]> => {
		const kids = ((await files.resolve(folder)).children ?? []).filter(
			(c) => !hidden(c.name),
		);
		const here = kids.filter((c) => !c.isDirectory).map((c) => prefix + c.name);
		if (depth >= DEPTH) return here;
		const below = await Promise.all(
			kids
				.filter((c) => c.isDirectory)
				.map((c) => walk(c.resource, `${prefix}${c.name}/`, depth + 1)),
		);
		return [...here, ...below.flat()];
	};
	return ranked(await walk(dir, "", 0)).slice(0, MAX);
};

/** What Show files needs from the widget or command that offers it. */
export type ShowFilesDeps = {
	readonly files: FileService;
	readonly quick: QuickInputService;
	readonly openers: OpenerService;
	readonly messages: MessageService;
};

// A worktree goes when its task lands, so a tab into it is not kept across restarts (ADR-140): the
// layout skips a widget whose state is undefined, where it would come back as "Not Found".
const notKept = (tab: unknown) => {
	const stateful = tab as Partial<StatefulWidget> | undefined;
	if (typeof stateful?.storeState === "function")
		stateful.storeState = () => undefined;
};

/**
 * Lists the files of a task's worktree and opens the one picked, a page rendered (ADR-129, ADR-132):
 * the files its request lists as changed, or without a list every file of the folder (ADR-141).
 */
export const showWorktreeFiles = async (
	deps: ShowFilesDeps,
	worktree: string,
	changed?: readonly string[],
): Promise<void> => {
	const dir = URI.fromFilePath(worktree);
	try {
		const names = changed
			? ranked(changed)
			: await worktreeFiles(deps.files, dir);
		if (names.length === 0)
			return void deps.messages.info(
				nls.localize("mete/waiting/noFiles", "This task has no files to show."),
			);
		const pick = await deps.quick.pick(
			names.map((label) => ({ label })),
			{ placeHolder: nls.localize("mete/waiting/whichFile", "Which file?") },
		);
		if (pick)
			notKept(
				await open(
					deps.openers,
					dir.resolve(pick.label),
					isPage(pick.label) ? { openFor: "preview" } : {},
				),
			);
	} catch (e) {
		void deps.messages.warn(String(e));
	}
};
