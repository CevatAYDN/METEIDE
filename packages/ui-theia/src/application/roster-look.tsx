import type { CSSProperties } from "react";

// The Team view's shared look (ADR-089): its tones, each a METE token over a Theia colour, the
// codicon span, and a line of icon and words that wraps.

/** A state's or a bar's colour role. */
export type Tone = "accent" | "warn" | "good" | "bad" | "muted";

/** Each tone's colour: a METE token with a Theia colour as its fallback. */
export const TONES: Readonly<Record<Tone, string>> = {
	accent: "var(--accent, var(--theia-focusBorder))",
	warn: "var(--warn, var(--theia-editorWarning-foreground))",
	good: "var(--good, var(--theia-testing-iconPassed))",
	bad: "var(--bad, var(--theia-errorForeground))",
	muted: "var(--muted, var(--theia-descriptionForeground))",
};

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
