---
"@mete/contracts": minor
"@mete/knowledge": minor
---

Agents can read and write the workspace vault, `.mete/knowledge/`: `vault_read` reads a note by its path (never a note marked `private: true`), and `vault_write` saves a lesson, entity or decision note by its title, or adds a section to today's journal note. A note with the same title is updated, a run writes at most 3 new notes, and every write goes through the policy like any file write (ADR-145).
