// The panels' colour roles (docs/13, Design system; ADR-069): each is a METE token with a Theia
// colour as its fallback, which a high-contrast theme uses, since its panel root sets no tokens.

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
