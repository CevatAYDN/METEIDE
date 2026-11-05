---
"@mete/cli": patch
---

`mete daemon` masks the message of a handler that throws through secrets.mask@1 before it reaches the client, and withholds it when the masker is not active; the run lock removes a stale lock only while its text is unchanged, so a lock written meanwhile survives; `mete key set` refuses a piped key that spans more than one line.
