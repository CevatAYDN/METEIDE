---
version: 1
slug: "ia-src-infrastructure-settings-widget-tsx-a866815f"
primary_target: "packages/ui-theia/src/infrastructure/settings-widget.tsx"
related_targets: ["packages/ui-theia/src/application/settings-view.tsx"]
---

# Skill Settings Extension

Mode: Operate. Local extension of the existing Settings surface; the user
approved ADR-189 and explicit implementation. No new visual identity or assets.

## Direction contract

THESIS: Exact source/version approval belongs beside existing workspace controls,
not in a marketplace or an agent-success dashboard.

OWN-WORLD: Inherit Theia theme tokens, codicons, compact native buttons, the
existing settings navigation and flat section layout. No new palette or fonts.

STORY: Choose Skills, discover local entries, inspect a complete masked version,
then explicitly approve or disable it. Errors and stale state remain visible.

FIRST VIEWPORT: Keep Settings navigation and search. Show a compact Skills heading,
refresh action and source/status rows. Review expands inline with bounded scrolling
for the complete source. Generic YAML Save/Apply scope controls do not imply that
skill approval writes workspace/global YAML.

FORM: Existing surface extension, code-led; no concept tournament.
seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Existing DESIGN.md is preserved. Historical light/wide and dark/narrow Tools
captures were inspected only as visual references, not current acceptance.
Final proof must use the source-built Electron app with isolated fixtures.
