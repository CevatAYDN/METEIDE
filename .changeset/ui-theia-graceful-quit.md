---
"@mete/ui-theia": patch
"@mete/desktop": patch
---

Quitting the desktop no longer kills METE's daemon mid-step: it is started detached, so it sees its input close, stops cleanly and frees the folder's run lock. Before, on Windows the daemon died with the window and left the lock behind.
