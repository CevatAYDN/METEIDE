---
"@mete/ui-theia": minor
---

The team editor shows a team's members as a grid of tiles (name, tier in plain words, the first line of its goal, its task count) with the chosen member's form beside the grid, instead of every member's form in one long page. A member's model tier is a row of tiles (Thinker, Coder, Fast, Long reads, Sees images) with the tier id beside each, in place of a select. An Order of work list under the tiles shows the tasks in the order a run can start them, each with its member, what it waits for and who approves it, and a click on a row opens its member A new team can start blank: "METE: New team" (palette, the METE menu and a button in the run composer) asks for a name and an id and opens the editor on a team with one member and one task to write, which Save writes to .mete/teams (ADR-093).
