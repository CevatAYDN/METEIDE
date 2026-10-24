---
"@mete/ui-theia": minor
---

The Team view shows how full each member's model context is, as a bar and as words ("Context 48% · 61k of 128k"); the bar turns to the warning colour from 80%. Each row also shows the tokens and calls of every agent the role has had, and the summary line adds the run's tokens. The context window comes from the gateway's model listing through `mete/models`. A model with no listed window shows the tokens alone, and a run recorded before this change shows neither (ADR-090).
