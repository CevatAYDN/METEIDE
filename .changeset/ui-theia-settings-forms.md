---
"@mete/ui-theia": minor
---

The Settings screen edits the gateway (models, daily spending cap), privacy (allowTraining) and policy (autonomy, budget) sections with forms that save to this folder's `.mete/<section>.yaml` or, with "Save for every folder", to the global `settings.yaml`, keeping the file's comments and other keys (ADR-082).
