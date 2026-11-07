import { TOKENS } from "@mete/ui-kit";
import { describe, expect, it } from "vitest";
import { panelRoot } from "../src/application/panel-root.js";

// A METE panel's root (ADR-069): the design tokens in Theia's light and dark themes, none in a
// high-contrast theme, so every style falls back to Theia's colours there.

describe("a METE panel's root", () => {
	it("keeps METE accents but uses neutral Theia surfaces in light and dark themes", () => {
		expect(panelRoot("light")).toEqual({
			className: "mete-panel",
			style: expect.objectContaining({ "--accent": TOKENS.light.accent }),
		});
		expect(panelRoot("dark").style).toEqual(
			expect.objectContaining({
				"--bg": "var(--theia-editor-background)",
				"--ink": "var(--theia-foreground)",
				"--accent": TOKENS.dark.accent,
			}),
		);
	});

	it.each(["light", "dark"] as const)(
		"uses foreground for secondary text on tinted %s surfaces",
		(type) => {
			expect(panelRoot(type).style).toEqual(
				expect.objectContaining({
					"--muted": "var(--theia-foreground)",
					"--muted-2": "var(--theia-foreground)",
				}),
			);
		},
	);

	it("sets no token in a high-contrast theme", () => {
		expect(panelRoot("hc")).toEqual({ className: "mete-panel" });
		expect(panelRoot("hcLight")).toEqual({ className: "mete-panel" });
	});
});
