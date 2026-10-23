import type { TabBarDecorator } from "@theia/core/lib/browser/shell/tab-bar-decorator";
import type { WidgetDecoration } from "@theia/core/lib/browser/widget-decoration";
import { Emitter } from "@theia/core/lib/common/event";
import { nls } from "@theia/core/lib/common/nls";
import type { Title, Widget } from "@theia/core/shared/@lumino/widgets";
import { injectable } from "@theia/core/shared/inversify";

// The Approvals inbox badge (docs/13): the count of runs that wait for the human on the Home tab.
// The Home view sets it on every answer it draws, so it is as fresh as the inbox under it.

/** The id of the Home view's widget, whose tab carries the badge (MeteHomeWidget.ID, which imports this file). */
const HOME_ID = "mete.home";

@injectable()
export class MeteInboxBadge implements TabBarDecorator {
	readonly id = "mete.inbox.badge";
	protected readonly changed = new Emitter<void>();
	readonly onDidChangeDecorations = this.changed.event;
	protected count = 0;

	/** Sets how many runs wait; the tab redraws only when the count changes. */
	set(count: number): void {
		if (count === this.count) return;
		this.count = count;
		this.changed.fire();
	}

	decorate(title: Title<Widget>): WidgetDecoration.Data[] {
		if (title.owner.id !== HOME_ID || this.count === 0) return [];
		return [
			{
				badge: this.count,
				tooltip: nls.localize(
					"mete/home/waitingBadge",
					"{0} run(s) wait for you",
					this.count,
				),
			},
		];
	}
}
