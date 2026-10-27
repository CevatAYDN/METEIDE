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

The design set in docs/design is now the screens' canonical look (ADR-128). The hero's status pill
shows a glyph once the run settles (pause, check, error), a single agent's number tiles stand at the
band's right, and the member tiles are wider. A Waiting for you card leads with its kind as a wash
pill over the sentence that names the member, with icons on its buttons and a policy ask on a raised
line of its own.

A single agent that failed leads its center with the failure, its code and its message, where a
finished one shows its answer. The Studio's list of the latest events has a visible caption.

The Team view's members are the design set's cards: the initial tile with its state badge, the name
with its tier and model under it, the state as a wash pill over the tasks done, and a strip of what
the member does now, its context share over its bar, and the run's model choice.
