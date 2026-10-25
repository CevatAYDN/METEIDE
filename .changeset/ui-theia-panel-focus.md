---
"@mete/ui-theia": patch
---

A METE panel takes focus when it opens (ADR-112): the command that opened it — a keyboard shortcut, the palette or a Home row's link — leaves the keyboard in the panel instead of in the widget before it, Theia counts the panel active at once instead of after its two-second activation check, and the first click on a button of a freshly opened panel is delivered.
