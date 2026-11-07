import { tokenProperties } from "@mete/ui-kit";
import {
	getThemeMode,
	isHighContrast,
	type ThemeType,
} from "@theia/core/lib/common/theme";
import type { CSSProperties } from "react";

// ADR-180: operational surfaces follow the active IDE theme; METE keeps its semantic accents.
// High contrast still sets no tokens, leaving each stylesheet's Theia fallbacks in charge.
const surfaces = {
	"--bg": "var(--theia-editor-background)",
	"--panel": "var(--theia-editorWidget-background)",
	"--raised": "var(--theia-sideBar-background)",
	"--side": "var(--theia-sideBar-background)",
	"--chrome": "var(--theia-titleBar-inactiveBackground)",
	"--ink": "var(--theia-foreground)",
	// Description foreground is too faint on sidebar and selected-row washes.
	"--muted": "var(--theia-foreground)",
	"--muted-2": "var(--theia-foreground)",
	"--line": "var(--theia-panel-border)",
	"--line-soft": "var(--theia-panel-border)",
	"--chip": "var(--theia-editorWidget-background)",
};

/** Spread on a panel's root element. */
export const panelRoot = (
	type: ThemeType,
): { readonly className: string; readonly style?: CSSProperties } =>
	isHighContrast(type)
		? { className: "mete-panel" }
		: {
				className: "mete-panel",
				style: {
					...tokenProperties(getThemeMode(type)),
					...surfaces,
				} as CSSProperties,
			};
