---
"@mete/contracts": minor
"@mete/cli": minor
"@mete/ui-theia": minor
---

The team editor's member form gains Draft with a model (ADR-108): `mete/member.draft` (daemon protocol 20) asks the web for pages, sends one fast-tier model call, and fills the form with the drafted goal, backstory and first task for review — nothing is written until the user saves.
