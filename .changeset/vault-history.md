---
"@mete/knowledge": minor
---

An agent's `vault.write@1` that updates a note by its title first copies the note's old text to `.mete/knowledge/.history/<note path>/<time>.md`, so nothing an agent replaces is lost (ADR-173). A note `vault.read@1` answers counts as one access of aging, as a search hit does; the vault module now requires `storage.sql@1` for those counts.
