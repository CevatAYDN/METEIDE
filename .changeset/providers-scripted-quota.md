---
"@mete/providers": minor
---

The scripted chat provider's file may also narrow its quota unit — `{ "turns": [...], "quota": { "limit": 1, "reset": "fixed_daily" } }` — while the turns alone keep working (ADR-111). With a limit of one request and a fixed daily reset, the desktop's end-to-end tests put a run into a real quota pause and show what a user sees until it ends: Home names the spent provider, offers "Resume now" (ADR-059) and the Quota dashboard shows the used unit (ADR-113).
