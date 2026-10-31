---
"@mete/core": patch
---

A team task searches its lessons once for each conversation it opens. Before, a task sent back for revision, and a best-of-N task's next attempt that opens as the first one did (after its questions), searched again although their conversation already held the lessons, spending a search and its embedding call each time. A next attempt that opens a fresh conversation still searches for it.
