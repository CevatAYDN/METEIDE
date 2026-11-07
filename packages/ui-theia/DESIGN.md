---
name: METE IDE Operational UI
description: Compact workspace controls aligned with the active editor theme.
rounded:
  progress-thin: 2px
  progress: 3px
  control: 4px
  item: 8px
  dot: 999px
spacing:
  compact: 8px
  row: 12px
  section: 16px
components:
  button:
    rounded: "{rounded.control}"
    padding: 4px 10px
    height: 28px
  icon-button:
    rounded: "{rounded.control}"
    height: 28px
    width: 28px
---

# METE IDE Design System

## Overview

The approved direction is a familiar working IDE: compact controls, readable
conversations, predictable navigation and explicit installation actions.
Operational panels follow the native shell. The existing Studio artwork remains
an event-driven view, not decoration for forms.

## Colors

The active Theia theme owns neutral surfaces, text, borders and primary buttons.
`panelRoot` maps METE's operational aliases to those live theme variables.
Semantic METE status accents remain distinct. High contrast uses native fallback
tokens without overriding the theme palette.

## Typography

Panel text inherits Theia's UI family and size. Conversation headings use a compact
15px semibold hierarchy. Paths, code and measured data can use the bundled
JetBrains Mono. Letter spacing is zero. Bundled fonts retain their existing
provenance in `THIRD_PARTY_NOTICES.md`; no new font or raster asset was introduced.

## Layout

Conversation uses a bounded header, a scrolling message region and an in-layout
composer. Input/actions must remain visible without scrolling the entire editor.
The maximum conversation width is 1040px. Settings uses a category navigation and
unframed section bodies, with local search and a visible save scope.
Narrow panels wrap tool rows, arguments and actions without horizontal page overflow.

## Elevation & Depth

Operational sections are flat. Thin boundaries and theme surfaces distinguish
regions; sections do not float as cards and do not nest inside cards.
Existing native popup and editor elevation remains under Theia's control.

## Shapes

Controls use the control radius; genuinely repeated framed items use the item
radius. Status labels are compact, not oversized pill containers.
Icon controls have fixed dimensions and accessible names.
Small progress tracks and circular status dots retain their geometry-specific
radii; these are not alternative radii for cards or controls.

## Components

- Buttons use native theme colors, visible focus rings and disabled states.
- Settings search filters translated categories and section IDs without changing drafts.
- Tool rows separate unsaved, saved/pending, connecting, failed and tested states.
- Guided setup uses labeled inputs, native selects and an explicit connection method.
- Catalog results are source-backed; prepared requirements stay visible and block incomplete additions.
- Conversation tools use explicit group selection; unknown saved selections are not treated as empty.
- Editor extensions retain the native install, trust and enable/disable controls.

## Do's and Don'ts

- Do use the existing codicon system, semantic controls and native theme variables.
- Do keep errors next to their inputs and retain drafts on failures.
- Do test complete actions in Electron in light, dark, high contrast and narrow panels.
- Do preserve the Studio artwork and its existing provenance.
- Do not add decorative heroes, gradients or nested section cards to operational views.
- Do not show Connected for a saved draft until the effective configuration was tested.
- Do not describe editor extensions as sandboxed agent tools.
