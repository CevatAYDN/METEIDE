---
"@mete/storage": patch
---

Cap a persisted event's payload at 64 KB of JSON: a larger payload is stored cut with a `{ cut, bytes, head }` marker, warned once, and reported as a broken row on read; the live event is untouched.
