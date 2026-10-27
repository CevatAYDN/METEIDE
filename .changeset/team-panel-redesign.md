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

Fields and buttons share the design set's controls in every panel: a field is 36 px with its border
in the accent while it has the focus, numbers and keys in mono, placeholders in --muted, and a choice
with a thin chevron in place of the platform's arrow; a field or a button that cannot act is a quiet
raised plate with faded words, no longer a see-through one.

The Settings screen takes the design set's frame: a hero band with its tile, title and caption,
Refresh at the right and the loaded note under them, with the scope switch beside it as a segmented
control; the groups on a side card at the left, each with its glyph's tile and a dot for a value set
for this folder only; the chosen group's title with its links at the right; each section a card with
its id in mono and each file's YAML on a raised block under its path; and the save bar as an accent
band at the foot that now also holds Apply now, past a rule, with the reason it waits beside it.

A Settings section's card says where its form's value comes from in its head, as a pill beside the
title (a warn wash with a dot when this folder's file sets it), with Reset beside it as a small ghost
button; field labels are quiet and bold over their fields, and every form's Saves to line, on the
Welcome screen too, starts with a file glyph.

The custom endpoints card takes the design set's look: each endpoint on a raised inset with its
fields two by two (ids, URLs and formats in mono), a rule, its key beside Test…, the models Test
lists as a card of rows whose last probe shows as a green or red pill with its glyph, and Remove as a
ghost button; the card's foot puts where it saves at the left and Add endpoint and Save at the right.
Set key carries a key glyph, on the Welcome screen too.

The team editor opens with the design set's hero band: the team's tile and id, with Open YAML and
Save beside the title, where the team saves under it, what blocks Save as a red-washed row, the name
and description, a copy under another id past a quiet rule, and the revision limit and budget as
three tiles with their numbers in mono at the right. The Save buttons keep their place above the
members (ADR-093).

The team editor's members are the design set's tiles: a round face with the member's initial (ringed
in the accent while its form is open), the name with its tier and glyph, the goal's first line and a
count of its tasks, which is a dashed outline while it has none; Add member is a dashed tile. The
order of work is a card whose steps hang on a rail, each with its number, title, member and what it
waits for.

The selected member's form takes the design set's look: its ringed face and name with Draft with a
model and Remove in the head; the id (locked with a lock glyph while the file fixes it), name, goal
and backstory on a grid; the model tier as five tiles whose own tile carries the accent and a check;
Needs as ticks that become accent chips beside the pinned model; capabilities, families and wake-up
artifacts as removable chips with a dashed field that adds one; and each task, and the defaults a task
list gives the member, as a raised card with its fields on a grid.

The Quota dashboard takes the design set's look: the shared hero band, then one card whose table
names each provider once over its units, shows the amount used over a thin bar of its limit that
grows in, and opens a unit's history in place as dated amounts on a rail (a button with a chevron
instead of a folded list). Settings and the dashboards share one hero band and frame.

The Audit log takes the same frame: the shared hero band with Refresh and Export beside the title, a
filter bar whose set filters are tinted in the accent, and the rows in a card with each verdict as a
pill, its word and glyph in the tone of allow, ask or deny. The Quota and Audit tables share one
card.
