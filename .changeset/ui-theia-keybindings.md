---
"@mete/ui-theia": minor
---

Every METE action that opens a panel gains a keyboard shortcut, so the command palette is not the only keyboard path (docs/13): Open home (`Ctrl+Shift+M` / `Shift+Cmd+M`), Open approvals (`Ctrl+Shift+A` / `Shift+Cmd+A`), Start run (`Ctrl+Shift+Enter` / `Shift+Cmd+Enter`), Open quota dashboard (`Ctrl+Shift+Q` / `Shift+Cmd+Q`). Stop all keeps `Ctrl+Shift+.` / `Shift+Cmd+.` (ADR-065). No shortcut collides with Theia's own defaults or the built-in VS Code extensions.
