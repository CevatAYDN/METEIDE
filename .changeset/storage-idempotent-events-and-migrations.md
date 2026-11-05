---
"@mete/storage": patch
---

An event published twice is stored once instead of crashing the storage module; a module's migrations run with their ledger read in one immediate transaction, so two processes migrating at once cannot apply the same migration twice; and both databases enforce foreign keys.
