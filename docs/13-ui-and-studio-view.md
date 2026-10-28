# 13 UI and studio view

Repository file: `docs/13-ui-and-studio-view.md`. Depends on: 07 Domain model and events, 08 Orchestration and teams.

The desktop UI is Theia plus METE panels; its signature is the studio view, where agents appear as small characters and every movement is a real event, as in the approved concept demo \[C\].

## Screens

| Screen | Purpose | Key elements |
| --- | --- | --- |
| Onboarding wizard | First start | Language (English or Turkish); provider keys for NVIDIA, OpenRouter and OpenCode Zen (at least one required, with links to get keys); privacy choice (training providers off by default); personal vault folder; web search (Exa MCP default, optional Tavily and Exa keys) \[C\]. Built as the Welcome screen (ADR-088), which with a folder open shows each keyed provider's state (ADR-147): the vault folder comes with the vaults (ADR-144), the Exa key with an Exa API adapter, and the privacy choice is saved once a folder is open |
| Home | Entry point | The METE view on the left, collapsible sections: Waiting for you, Runs (a click shows the run in the Team panel, which the list marks; an ended run has Remove, the pill Forget is, which asks in a dialog and then deletes the run with its worktrees, branches, checkpoints and history, ADR-143), Workspaces (each folder by name over the tail of the folder that holds it; a click opens it in this window, or in a new one while a run here is running or queued, since this folder's daemon ends with the switch; Forget drops it from the list and leaves the folder on disk; Open folder adds one; ADR-084), Quota summary (ADR-078); each section's title carries its count and each run, waiting row and folder is a two-line row with an icon tile in the row's tone, the side vocabulary of the redesign (ADR-109); the quota section is the raised card the redesign puts at the view's foot (ADR-109) |
| Workspace | Daily work | Theia editor, project search (ADR-101), terminal (ADR-099), source control (the built-in git extension through the extension host, ADR-103), language services for TypeScript and JavaScript, CSS, HTML, JSON and Markdown (built-in extensions, ADR-104), debugging of Node.js and the browser through the built-in js-debug extension (`@theia/debug`, ADR-105), METE panels |
| Changes | Review the working tree | The open folder's changed files from `vcs.git@2` (ADR-100): one row per file with a word for how it stands, the picked file's diff, Refresh, and an Open file action that opens the picked file in the editor (a deleted file offers it not; ADR-102); a folder that is not a git repository says so and points at a run's checkpoints (ADR-080) |
| Run composer | Start work | Goal field, template picker with the router's suggestion, request estimate per provider (shown under each option, ADR-068), autonomy level (waits for a per-run level), Start; the Team panel with no run shown (ADR-071, ADR-078) |
| Team panel | Watch a run | Three views on the same events: Studio, Flow (React Flow), Board (kanban) \[C\], and a fourth, Team: one row per role with its tier, model, state and what it does now (ADR-089), and how full its model's context is with the tokens it has used (ADR-090); a hero band above the views: the run's status and goal, its team, start and end time, autonomy and limits, its tokens, calls and checkpoints as number tiles, and in a team run a ring of its approved tasks and one initial tile per member (ADR-094, ADR-127); the one run view in the main area, re-targeted by a selection (ADR-078); under the strip two columns (ADR-119): the center holds the Now slot — Waiting for you when the human is asked, otherwise the agent whose model call is in flight (ADR-127) — the view switch (a single-agent run's reads Steps, Studio and Team, ADR-127), the chosen view and the run's checkpoints with a Restore button (ADR-079), and a 380 px right rail holds three tabs, Artifacts and Tasks with their counts (ADR-127) — Activity, who asked whom and who did what, newest first, with segments, Follow and a peek at each event (ADR-092); Artifacts, the run's reports with Open, while a Done card opens its report too (ADR-085), and under them, for a completed run, the files it changed with Open, a page rendered (ADR-133); and Tasks, each task with its status and member. A finished single-agent run has no board: the center shows the agent's answer as Markdown, and the Activity feed's completed row carries it; a failed run shows its error message. A single-agent run's center shows its steps, from `mete/run.transcript`, and once the run has ended its answer above them with the steps closed (ADR-127), or, for a run that failed with no answer, the failure's code and message in the answer's place (ADR-128): the agent's text as Markdown and each tool call as one line that opens its arguments and result; in a team run a task's row in the Tasks tab opens that task's steps; the panel asks again after the run's step events, and a thinking agent's row counts the seconds since its `agent.thinking.started`, in the steps and the Team view (ADR-125). The rail opens on Artifacts once the run is finished and has a report, or is completed and changed files (ADR-133), on Activity otherwise, and goes under the center in a panel narrower than 900 px (ADR-119) |
| Approvals inbox | Human gates | Pending approvals and blocked tasks — a guardrail's retries ran out, a capability is missing, or an agent asks a question (docs/07) — with artifact preview and diff, and for a task that wrote files in a worktree a Show files button that lists them (the files git sees changed there, when the request names them, ADR-141) and opens the one picked, a page rendered in the Mini Browser (ADR-129, ADR-132), which the Home view's Open artifact also does for a run with no report (ADR-133); Approve, Revise with feedback for a submission, Go on or an instruction for a blocked task (ADR-110), and for a task that asks the human before its work its questions, one per line, with Answer… and Go on without answers (ADR-142); a policy ask names the action and the command or path asked about, with Allow once, Allow for this run and, for a command, Always allow (ADR-121); the Home view's Waiting for you lists every waiting run (ADR-048), and the Team panel's strip names, for the run it shows, each member whose task waits for the human, with its report and its answers, as one card per task (ADR-091, ADR-110, ADR-119) |
| Replay | Look back | Timeline scrubber over the event log; Studio, Flow and Board show the past state; speed 1x, 2x, 4x \[C\] |
| Quota dashboard | Capacity | Per provider and unit: used, limit, reset time, history |
| Knowledge | Memory | Code graph view (Sigma.js), vault browser, hybrid search |
| Assets | Generated media | The files tools save under `.mete/assets/`, newest first: an image as its picture, and every row's media type, size and the MCP server and tool that saved it; other files open in Theia; a GLB preview (`<model-viewer>`) and a license column per file join when a viewer and a license source are approved (ADR-114) \[C\] |
| Settings | Control | Providers and custom endpoints (form, key, Test; ADR-087), Bindings (a row per capability: its id and its adapters in fallback order; ADR-096), Policy and autonomy, MCP servers (a card per server: its id and transport, its command or URL, its permissions; ADR-097) and plugins (registry search, install with permissions), Skills, Templates (YAML editor plus visual editor; the visual editor is the team editor screen, ADR-075 and ADR-076, with a member's pinned model, ADR-077; its members are a grid of cards with the selected member's form beside it, its tier a choice of tiles, its tasks listed in the order of work, a new team can start blank, ADR-093, and the selected member's form has a Draft-with-a-model button whose answer fills the form for review, ADR-108), Appearance, Language; read-only first: what the daemon loaded per section and from which file (ADR-081); forms for the gateway, privacy, policy and shell sections, saved to this folder's file or globally (ADR-082, ADR-098), and Apply now in the save bar, which restarts the daemon while no run is running (ADR-083, ADR-128); the sections are grouped in plain words in a list at the screen's left (Models and keys, What the team may do alone, Privacy, Tools and web search, Teams, Look and language, Other files), each section's card titled in plain words with its id as a caption, with a scope switch and one save bar (ADR-095) |
| Audit log | Accountability | Filterable list, JSON export |

Settings, the Quota dashboard and the Audit log do not come back when METE starts again; the Team panel, the team editor and Theia's editors do (ADR-086).

The run composer asks for the goal, then offers "Let METE choose" (the router decides, and asks with its suggestions when it is unsure), each template of `mete/templates` by name with its description, and "Single agent" (ADR-058).

A run paused for quota shows under its row why each provider cannot carry it on, and a "Resume now" button; "METE: Resume run" offers it too (ADR-059), so a key or privacy change takes effect before the pause's reset. A run paused by the user, which a desktop quit does to a running run, shows a "Resume" button and is offered by "METE: Resume run" too (ADR-061). A run paused for its budget shows Resume too, with a line that names the budget: 25 model turns at a time, or the requests or hours of `.mete/policy.yaml`, to raise first if they ran out (ADR-126).

"METE: Stop all" (`Ctrl+Shift+.`, and a "Stop all" button at the left of the status bar) is the kill switch of SECURITY.md: it sends `mete/stop.all` to the daemon of the open folder at once, without asking, and shows how many runs it cancelled, or that there were none (ADR-065). Runs of other folders are not driven by this desktop and stay as they are.

The Quota dashboard is its own view, "METE: Open quota dashboard": a table of the `units` of `mete/quota` (ADR-054), one row per provider, unit and model scope with used, limit and reset time and, on request under each row, its history: each amount in the window with its time (ADR-055); it asks again on every `quota.*` event.

## Studio view

The studio view is the module `ui-studio`. It subscribes to events, keeps a derived view model and draws it with PixiJS. It MUST NOT call models or change domain state \[C\].

The Team panel's views share one view model: a pure fold over the run's events, fed first by the run's history (`mete/events`) and then by the live stream, applied once per event id, so a panel opened mid-run, after a restart or in Replay shows the same state. The fold is a library in `ui-studio`; the Board is the first view, a widget of `ui-theia`. Board columns: To do holds `todo`; In progress holds `in_progress`, `submitted` (marked in review), `changes_requested` (marked changes asked) and `blocked` (marked blocked); Done holds `approved` (ADR-051). The Flow view draws the tasks as nodes, one level after the deepest task they wait for, and `dependsOn` as edges; the agents stand as nodes under the task they work on, each with an edge to it, dashed and lit while the agent thinks, with its tool's last progress step as `progress/total` (ADR-067) \[D\].

The Studio view is the Team panel's third view, on the same fold (ADR-052). Its default theme is the cozy office of the approved demo, drawn as shapes in the demo's own colours, the same in every Theia theme; the Design system's tokens colour the panel around it (ADR-070). Desk rows come from events: a role seen approving or reviewing sits in the top row. An agent waits at the coffee corner while its run is paused for quota and its current provider's quota is exhausted and not yet restored. The effects of the table below play for live events only, so a panel opened later draws the state; an effect aimed at a role plays at that role's first character and is skipped when it has none \[D\].

Scene layout \[D\]: a top-down room generated from the team. Roles that plan or approve sit in the top row; other roles in the bottom row; at most 6 desks per row. Fixed props: the task board on the wall (columns To do, In progress, Done), a coffee corner (quota waits), a bookshelf (the vault), a window showing the user's local time of day (can be turned off), plants and a clock. More than 12 agents are grouped into one character per role with a count badge \[C\].

Characters: one per agent, colored by role. Accessories by role kind: pencil for designer, glasses for lead, hood for developer, beret for artist, headset for tester, clipboard for PM; other roles get one from a seeded set \[D\]. Events carry no role kind yet, so every role takes its colour and accessory from the seeded set (ADR-070) \[D\]. Labels show the role name; a setting switches to friendly first names \[D\].

| Event | What the studio shows |
| --- | --- |
| `task.created` | A sticky note drops into To do |
| `task.assigned` | An envelope flies from the assigner to the agent; the note moves to In progress |
| `task.status.changed` to `approved` | The note moves to Done with a sparkle; small confetti at the approver |
| `task.status.changed` to `changes_requested` | An envelope flies back to the agent with a short "!" |
| `task.status.changed` to `blocked` | A large red pin with a "!" on the note, while the task stays blocked (every note has a small red pin); a red "!" above the agent |
| `agent.thinking.started` / `ended` | Thought bubble with moving dots above the head |
| `agent.tool.called` | The monitor shows the work: code lines for `fs.*`, a results page for `web.*`, a painting for `media.*`, test rows for verify gates and `gameengine.test@1`, a stamped document for reviews, bars for planning |
| `agent.message.sent` (handoff) | An envelope flies between the two agents; the speech bubble shows `summary` |
| `agent.message.sent` (review, report) | The sender walks to the receiver's desk; bubble shows `summary` |
| `review.requested` | The author walks over and sits beside the reviewer |
| `quota.exhausted` for a waiting agent | The agent walks to the coffee corner; floating "z" and a countdown to `resetsAt` |
| `quota.restored` | The agent returns to the desk |
| `run.paused` with reason `network` | Monitors show an offline icon; the room dims |
| `approval.requested` for the human | A bell above the approver's desk and a badge on the Approvals inbox |
| `vault.note.saved` | A book flies to the shelf and glows |
| `run.completed` | Confetti; every character jumps |

Interaction: clicking a character opens a card with role, tier, provider and model, status, current task and request count \[C\]. Clicking a note opens the task; the bookshelf opens the vault; the coffee corner opens the quota dashboard. The live view always runs in real time; speed controls exist only in Replay \[D\].

Performance and access \[D\]: drawing stops when the panel is hidden; 30 frames per second when idle, 60 while animating; at most 300 particles; reduced motion removes particles and makes moves instant. Every visual event is also written to an accessible event list (`aria-live="polite"`) \[C\].

Themes are modules. The default theme is the cozy office of the demo; community themes (pixel art, 3D office) and character sprites made through `media.image.generate@1` are allowed \[C\]. Starter assets: Kenney CC0 \[C\].

## Design system

The tokens below come from the approved demo \[D\]; the derived tones and the component vocabulary (wash state pills, the button family, meters, JetBrains Mono) come from the founder's desktop redesign of 2026-10-25 (ADR-107).

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#ECEAF4` | `#17162A` |
| `--panel` | `#F8F7FC` | `#211F38` |
| `--line` | `#DAD6EA` | `#34315A` |
| `--ink` | `#24223A` | `#ECEAF7` |
| `--muted` | `#6B6785` | `#A6A2C4` |
| `--accent` | `#5B4BD6` | `#8F83F2` |
| `--good` | `#2FA38A` | `#4CC3A6` |
| `--warn` | `#E3A13A` | `#F0B75A` |
| `--bad` | `#D9544A` | `#EE7368` |
| `--chip` | `#E4E0F3` | `#2D2A4D` |
| `--chrome` | `#DCD8EC` | `#121122` |
| `--side` | `#E6E3F2` | `#1A192F` |
| `--raised` | `#EFEDF8` | `#1C1B32` |
| `--line-soft` | `#E2DEF0` | `#2A2848` |
| `--muted-2` | `#524E6E` | `#B9B5D6` |

`--chrome` (the app's own bars), `--side` (a side view), `--raised` (a surface one step above the background) and `--line-soft` (a quiet divider) are the redesign's depth tones; `--muted-2` is the redesign's secondary text, one step clearer than `--muted` \[D\]. A wash — a state's colour at a low share over the panel, made with CSS `color-mix` from the state token, never a separate value — fills a state pill, and the pill's text mixes the same state token toward `--ink` so it meets WCAG AA in both themes (the rule of ADR-106, kept); a small dot of the pure state token can sit before the word \[D\].

The redesign's components (ADR-127): the hero band (a `--raised` card that leads a screen: the state as a large wash pill, the subject as a Baloo 2 800 title, a meta line, and number tiles, a small caption over a JetBrains Mono number), the segmented control (one track, the chosen segment raised), initial tiles (a round tile with a role's initial and a state ring whose tone and corner icon follow the Team view's state looks, never colour alone), the progress ring (done over all), the thread line joining a feed's tiles, the step timeline, and the Now slot. Applying them to a screen restyles it; changing what a screen shows, or where, needs an ADR \[D\]. In a panel the hero band's subject is the panel's `h2`, where an artboard, being a page, has an `h1` \[D\].

The design set in `docs/design/` (ADR-128) is the canonical look of these screens: one artboard per screen state, in the light or the dark theme, on these tokens. This tab and the ADRs decide what a screen shows and where; the set decides how it looks, and whatever this tab leaves open. Where they disagree on what or where, this tab wins and the board is corrected; a board change that alters what or where a screen shows comes with an ADR and this tab's edit in the same commit \[D\].

- Typeface: Baloo 2 (weights 500 to 800) for METE panels and the studio; JetBrains Mono (weights 400 to 700, tabular numbers) for file paths, diffs, ids and every measured number in METE panels; the editor and terminal keep Theia's monospace font. Both font files are bundled, never loaded from the internet \[D\].
- METE's panels and the studio's frame use these tokens and this shape in Theia's light and dark themes, while the studio canvas keeps the demo's own colours (ADR-070); in a high-contrast theme the panels keep Theia's colours, since no high-contrast tokens are defined, and Theia's own chrome, editor and terminal always keep Theia's look (ADR-069) \[D\].
- Shape: 1.5 px borders; radius 10 px for controls, 14 to 16 px for panels, 20 px for the studio stage \[D\].
- Text: a title or a subtitle takes one line that ends in an ellipsis, and the row's tooltip keeps its whole text; a sentence that explains (why a run waits, why a state is unknown) wraps instead, because an ellipsis there would hide the reason \[D\].
- Keyboard-first: every METE action is a command in Theia's command palette (for example "METE: Start run", "METE: Stop all", "METE: Open approvals") and reachable by keyboard with a visible focus ring \[C\]. A panel takes focus when it opens, so the command that opened it — a shortcut, the palette or a Home row's link — leaves the keyboard in the panel, and Theia counts the panel active at once \[D\].
- Screens: a main panel is never reachable only from the palette — the METE menu lists them all, assets included, and the status bar carries new run and the day-to-day screens (team panel, changes, quota, audit log, settings) as buttons beside the waiting count; each button runs the same command its menu entry does (ADR-118) \[D\].
- Updates: Help → "Check for Updates…" checks the GitHub release in the app's main process; its answer is one sentence (no release published yet, releases GitHub does not show, from source, newest, or downloaded with "Restart now"), and a failure is a warning with its reason (ADR-137) \[D\].
- Copy: sentence case, plain verbs, errors say what happened and what to do next, no apologies \[D\].
- Localization: English default and Turkish; every UI string lives in resource files \[D\].
