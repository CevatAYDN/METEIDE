---
"@mete/ui-theia": minor
---

The Team panel leads with a hero band (ADR-127): the run's status as a pill over its goal, its team,
times, autonomy and limits on one line, its calls, tokens and checkpoints as number tiles, and in a
team run a ring of its approved tasks beside one tile per member with the member's state.

Under it, the Now slot shows the one thing that matters now: the Waiting for you cards when you are
asked, otherwise the member whose model or tool call is in flight, with its seconds or its tool's
progress, its model and its context share.

The view switch is a segmented control of tabs, with the arrow keys; a single-agent run's reads Steps,
Studio and Team, since it has no board or graph.

Once a single-agent run has ended, its answer leads the center as a card, above the view switch, and
its steps follow with each row closed.

The rail's Tasks tab counts the approved tasks of all, and the Activity feed hangs its rows on a
thread of tiles, an ask on its warn wash, under a segmented filter and a Follow switch.
