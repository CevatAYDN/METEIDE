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

The METE view takes the design set's side look on its own background: 28 px tiles, a running run's
glyph that turns (and stops for those who ask for less motion), round state pills with the time in
mono, goals in the ink, and the current run's row outlined. A waiting run is a card whose Approve is
the accent button and whose other answers are quiet ones with icons; a quota pause lists the blocking
providers on an inset card, each after a dot in its state's tone; each quota chip carries its state's
glyph, so a missing key and a used-up quota differ at a glance. Empty sections are dashed cards, Open
folder is the accent button only while no folder is open, and Forget is a small outlined pill. The
shared field and disabled-button rules wait for the Settings slice.

The Welcome screen takes the design set's look: a hero band with the rocket, the title and what the
screen is for, with the language step beside it; each step a card with its glyph's tile and its
number in the accent; a model provider's name, key state, field and Set key on one ruled line (its
name above the field in a narrow panel); privacy and web search side by side; and a start bar with
the big Start a run. The step titles drop their numbers from the translations, which the heading now
draws.
