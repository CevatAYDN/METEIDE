---
"@mete/core": patch
"@mete/cli": patch
---

A run whose stored snapshot cannot be read is marked failed on recovery instead of showing as running forever, and resuming or cancelling it answers "not found" instead of crashing. A run left queued by a crash is paused like a running one. A resume at the quota reset or a cancel on Ctrl+C that throws is logged or reported instead of ending the process without teardown.
