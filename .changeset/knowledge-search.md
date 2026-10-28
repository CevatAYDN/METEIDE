---
"@mete/contracts": minor
"@mete/knowledge": minor
---

Agents can search the workspace vault's notes by keywords: `knowledge_search` returns each matching note's path, title, section heading and a short snippet, best match first, and `vault_read` then reads the whole note. Accents do not matter (`subat` finds `Şubat`), the dotless `ı` still does. Notes marked `private: true`, files that `.meteignore` or `.gitignore` hide, and the vault's history are never searched. A team role gets the tool when its capabilities name `knowledge.search@1` (ADR-149).
