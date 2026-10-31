---
"@mete/core": patch
---

A team task searches its lessons once. Before, a task sent back for revision, and a best-of-N task's next attempt that opens as the first one did, searched again although their conversation already held the lessons, spending a search and its embedding call each time.
