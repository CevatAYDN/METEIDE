---
"@mete/cli": patch
---

Start new CLI runs through the versioned skill-aware entry point with the default
auto policy. Preserve existing resume paths and refuse a missing S2 start port
without silently falling back to a legacy run. Confirm optional-module removal
still allows the offline single-agent edit task to complete.
