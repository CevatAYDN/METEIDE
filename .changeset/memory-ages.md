---
"@mete/knowledge": minor
---

Memory ages (ADR-173): `knowledge.search@1` counts each note it returns as one access, at most once a minute, and ranks a cold note, an old lesson or journal note that nobody has found in a while, after the warm ones, so the 8 lessons a task opens with are the ones still in use. Pinned notes, decisions and entities never go cold, and nothing is deleted.
