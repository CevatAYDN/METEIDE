import type { CSSProperties } from "react";

// The Team view's shared look (ADR-089): the codicon span and a line of icon and words that wraps.

/** A codicon, hidden from screen readers: the words beside it carry the meaning. */
export const Icon = ({
	name,
	spin,
}: {
	readonly name: string;
	readonly spin?: boolean;
}) => (
	<span
		aria-hidden="true"
		className={`codicon codicon-${name}${spin ? " codicon-modifier-spin" : ""}`}
	/>
);

/** A line of an icon and words that wraps on a narrow panel. */
export const LINE: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "6px",
	minWidth: 0,
	flexWrap: "wrap",
};
