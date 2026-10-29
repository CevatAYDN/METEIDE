# Design set

The canonical look of METE's desktop screens (ADR-128; docs/13, Design system). docs/13 and the ADRs decide what a screen shows and where; these boards decide how it looks, and whatever docs/13 leaves open. Every word and number on a board is one the code produces. A board change that shows a new fact, or moves one to another place, comes with an ADR and the docs/13 edit in the same commit.

- `*.dc.html`: one artboard per screen state, plain HTML on the docs/13 tokens, in the light or the dark theme. Open one in a browser to view it. A board loads Baloo 2 and JetBrains Mono from Google Fonts for viewing only; the desktop bundles both. The `./support.js` a board names belongs to the canvas viewer, and a browser renders the board without it. Theia's own chrome a board draws for context, such as the METE view's title and its sections' headers, is the frame: the code never styles it (ADR-069).
- `canvas.json`: the canvas layout (version 3), with each board's page, place, size and title.

| Page | Boards |
| --- | --- |
| Team panel | `Main` (a team run waiting for you), `SingleRunning`, `SingleDone`, `TeamRoster` (the Team view), `TeamFlow`, `TeamStudio`, `TeamTasks` (the rail's Tasks tab), `TeamBlocked`, `TeamPolicyAsk`, `TeamMergeFailed` (a task whose merge did not land, ADR-156), `TeamFailed` (a failed single agent), `Composer` (the run composer), `TeamNarrow` (a panel under 900 px) |
| Home and welcome | `HomeActive`, `HomeEmpty` (the METE side view), `Welcome` |
| Settings and team editor | `Settings` (Models and keys), `TeamEditor` |
| Dashboards | `Quota`, `Audit`, `Assets`, `Changes` |
