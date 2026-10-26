import { Command, Disposable } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import {
	StatusBar,
	StatusBarAlignment,
} from "@theia/core/lib/browser/status-bar/status-bar-types";
import type {
	ViewContainer,
	ViewContainerPart,
} from "@theia/core/lib/browser/view-container";
import { nls } from "@theia/core/lib/common/nls";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import { inject, injectable } from "@theia/core/shared/inversify";
import { waitingBadgeText } from "../application/status-text.js";
import { waitingCount } from "../domain/home-model.js";
import { MeteHomeStore } from "./home-store.js";

// What waits for the user, outside the METE view's list (ADR-078): the status bar's count and the
// Waiting for you part that shows only while a run waits. Both change only when the count does.

/** The palette entry "METE: Show what waits for you", which the status bar's waiting count runs. */
export const SHOW_WAITING_COMMAND: Command = Command.toLocalizedCommand(
	{
		id: "mete.home.waiting",
		category: "METE",
		label: "Show what waits for you",
	},
	"mete/home/showWaiting",
	"mete/category",
);

const WAITING_ID = "mete.waiting";

/** "N waiting for you" at the left of the status bar while a run waits; a click shows them. */
@injectable()
export class MeteWaitingStatusBar implements FrontendApplicationContribution {
	@inject(StatusBar) protected readonly statusBar!: StatusBar;
	@inject(MeteHomeStore) protected readonly store!: MeteHomeStore;
	protected shown = 0;

	onStart(): void {
		this.store.onDidChange(() => void this.draw());
		void this.draw();
	}

	protected async draw(): Promise<void> {
		const count = waitingCount(this.store.model);
		if (count === this.shown) return;
		this.shown = count;
		if (count === 0) return this.statusBar.removeElement(WAITING_ID);
		await this.statusBar.setElement(WAITING_ID, {
			text: `$(bell-dot) ${nls.localize("mete/home/waitingCount", "{0} waiting for you", count)}`,
			tooltip: waitingBadgeText(count),
			alignment: StatusBarAlignment.LEFT,
			priority: 999,
			command: SHOW_WAITING_COMMAND.id,
		});
	}
}

type View = Pick<
	ViewContainer,
	| "getPartFor"
	| "disposed"
	| "containerLayout"
	| "isVisible"
	| "onDidChangeVisibility"
>;

// A part shown again comes back at its minimum height, too short for one row, since Theia kept no
// size for it: it gets its share of the open parts' height, and they keep their proportions.
const giveShare = (view: View, part: ViewContainerPart, share: number) => {
	if (part.isHidden || part.collapsed) return;
	const layout = view.containerLayout;
	const sizes = layout.widgets.map((p) =>
		p === part || p.isHidden || p.collapsed ? undefined : layout.getPartSize(p),
	);
	const rest = sizes.reduce<number>((sum, s) => sum + (s ?? 0), 0);
	layout.setPartSizes(
		sizes.map((s, i) =>
			layout.widgets[i] === part ? (rest * share) / (1 - share) : s,
		),
	);
};

// Sizes need the view on screen: a view in a hidden side bar measures nothing.
const whenVisible = (view: View, act: () => void): Disposable => {
	if (view.isVisible) {
		act();
		return Disposable.NULL;
	}
	const once = view.onDidChangeVisibility((visible) => {
		if (!visible) return;
		once.dispose();
		act();
	});
	return once;
};

/**
 * Shows the Waiting for you part only while a run waits, so an empty inbox takes no height, with
 * `share` of the view's height; it changes only when the count crosses zero, so a user who hides
 * it meanwhile keeps it hidden.
 */
export const followWaiting = (
	container: View,
	waiting: Widget,
	store: Pick<MeteHomeStore, "model" | "onDidChange">,
	share: number,
) => {
	let shown: boolean | undefined;
	let sizing = Disposable.NULL;
	const follow = () => {
		const now = waitingCount(store.model) > 0;
		if (now === shown) return;
		shown = now;
		const part = container.getPartFor(waiting);
		part?.setHidden(!now);
		sizing.dispose();
		if (now && part)
			sizing = whenVisible(container, () => giveShare(container, part, share));
	};
	follow();
	const listening = store.onDidChange(follow);
	container.disposed.connect(() => {
		listening.dispose();
		sizing.dispose();
	});
};
