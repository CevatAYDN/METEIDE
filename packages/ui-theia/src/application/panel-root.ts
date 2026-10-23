import { tokenProperties } from "@mete/ui-kit";
import {
	getThemeMode,
	isHighContrast,
	type ThemeType,
} from "@theia/core/lib/common/theme";
import type { CSSProperties } from "react";

// The root of a METE panel (ADR-069, docs/13 Design system): the class that carries Baloo 2 and the
// shape, and the colour tokens of the theme's mode. A high-contrast theme gets no tokens, so every
// style's Theia fallback colours the panel there.

/** Spread on a panel's root element. */
export const panelRoot = (
	type: ThemeType,
): { readonly className: string; readonly style?: CSSProperties } =>
	isHighContrast(type)
		? { className: "mete-panel" }
		: {
				className: "mete-panel",
				style: tokenProperties(getThemeMode(type)) as CSSProperties,
			};
