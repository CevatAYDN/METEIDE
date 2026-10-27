import type { KeyboardEvent } from "react";
import { Icon } from "./roster-look.js";

// WAI-ARIA tabs (ADR-119, ADR-127): one tab in the tab order, the shown one; the arrow keys, Home and
// End move the choice and the focus together, wrapping at the ends. The rail draws them as tabs, the
// view switch as the segmented control; each tab's panel is `<id>-<key>-panel`.

/** The tab an arrow, Home or End key moves to, wrapping at the ends; none for another key. */
export const stepTab = <T,>(
	tabs: readonly T[],
	tab: T,
	key: string,
): T | undefined => {
	const at = tabs.indexOf(tab);
	if (key === "ArrowRight") return tabs[(at + 1) % tabs.length];
	if (key === "ArrowLeft") return tabs[(at + tabs.length - 1) % tabs.length];
	if (key === "Home") return tabs[0];
	if (key === "End") return tabs[tabs.length - 1];
	return undefined;
};

/** One tab: its codicon, its words and, for a list, how many it holds. */
export type Tab<T extends string> = {
	readonly key: T;
	readonly icon: string;
	readonly label: string;
	readonly count?: string | number;
};

/** A row of tabs; the shown one names its panel. */
export const TabList = <T extends string>({
	id,
	className,
	tabs,
	shown,
	onPick,
}: {
	readonly id: string;
	readonly className: string;
	readonly tabs: readonly Tab<T>[];
	readonly shown: T;
	readonly onPick: (tab: T) => void;
}) => {
	const onKey = (e: KeyboardEvent<HTMLElement>) => {
		const next = stepTab(
			tabs.map((t) => t.key),
			shown,
			e.key,
		);
		if (!next) return;
		e.preventDefault();
		onPick(next);
		e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
	};
	return (
		<div role="tablist" className={className} onKeyDown={onKey}>
			{tabs.map((t) => (
				<button
					key={t.key}
					type="button"
					role="tab"
					id={`${id}-${t.key}`}
					data-tab={t.key}
					aria-selected={t.key === shown}
					aria-controls={t.key === shown ? `${id}-${t.key}-panel` : undefined}
					tabIndex={t.key === shown ? 0 : -1}
					onClick={() => onPick(t.key)}
				>
					<Icon name={t.icon} />
					{t.label}
					{t.count === undefined ? null : (
						<span className="mete-count">{t.count}</span>
					)}
				</button>
			))}
		</div>
	);
};
