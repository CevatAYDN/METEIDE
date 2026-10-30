---
"@mete/storage": patch
---

Storage loads sqlite-vec into the workspace and global databases before any migration (ADR-152), so a module can keep vectors in a `vec0` table beside its rows (ADR-012). A load that fails is logged once and leaves vector tables unavailable, never the database. Nothing uses it yet; the knowledge layer's vector source comes next.
