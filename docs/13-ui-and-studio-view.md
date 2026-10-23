# 13 UI and studio view

Repository file: `docs/13-ui-and-studio-view.md`. Depends on: 07 Domain model and events, 08 Orchestration and teams.

The desktop UI is Theia plus METE panels; its signature is the studio view, where agents appear as small characters and every movement is a real event, as in the approved concept demo \[C\].

## Screens

| Screen | Purpose | Key elements |
| --- | --- | --- |
| Onboarding wizard | First start | Language (English or Turkish); provider keys for NVIDIA, OpenRouter and OpenCode Zen (at least one required, with links to get keys); privacy choice (training providers off by default); personal vault folder; web search (Exa MCP default, optional Tavily and Exa keys) \[C\] |
| Home | Entry point | Workspaces, recent runs, quota summary |
| Workspace | Daily work | Theia editor, terminal, METE panels |
| Run composer | Start work | Goal field, template picker with the router's suggestion, request estimate per provider, autonomy level, Start |
| Team panel | Watch a run | Three views on the same events: Studio, Flow (React Flow), Board (kanban) \[C\] |
| Approvals inbox | Human gates | Pending approvals and clarifications with artifact preview and diff; Approve, Revise with feedback |
| Replay | Look back | Timeline scrubber over the event log; Studio, Flow and Board show the past state; speed 1x, 2x, 4x \[C\] |
| Quota dashboard | Capacity | Per provider and unit: used, limit, reset time, history |
| Knowledge | Memory | Code graph view (Sigma.js), vault browser, hybrid search |
| Assets | Generated media | Images and GLB previews (`<model-viewer>`), license manifest per file \[C\] |
| Settings | Control | Providers and custom endpoints (form, Test), Bindings (ordered adapters per capability), Policy and autonomy, MCP servers and plugins (registry search, install with permissions), Skills, Templates (YAML editor plus visual editor), Appearance, Language |
| Audit log | Accountability | Filterable list, JSON export |

The run composer asks for the goal, then offers "Let METE choose" (the router decides, and asks with its suggestions when it is unsure), each template of `mete/templates` by name with its description, and "Single agent" (ADR-058).

A run paused for quota shows under its row why each provider cannot carry it on, and a "Resume now" button; "METE: Resume run" offers it too (ADR-059), so a key or privacy change takes effect before the pause's reset. A run paused by the user, which a desktop quit does to a running run, shows a "Resume" button and is offered by "METE: Resume run" too (ADR-061).

"METE: Stop all" (`Ctrl+Shift+.`, and a "Stop all" button at the left of the status bar) is the kill switch of SECURITY.md: it sends `mete/stop.all` to the daemon of the open folder at once, without asking, and shows how many runs it cancelled, or that there were none (ADR-065). Runs of other folders are not driven by this desktop and stay as they are.

The Quota dashboard is its own view, "METE: Open quota dashboard": a table of the `units` of `mete/quota` (ADR-054), one row per provider, unit and model scope with used, limit and reset time and, on request under each row, its history: each amount in the window with its time (ADR-055); it asks again on every `quota.*` event.

## Studio view

The studio view is the module `ui-studio`. It subscribes to events, keeps a derived view model and draws it with PixiJS. It MUST NOT call models or change domain state \[C\].

The Team panel's views share one view model: a pure fold over the run's events, fed first by the run's history (`mete/events`) and then by the live stream, applied once per event id, so a panel opened mid-run, after a restart or in Replay shows the same state. The fold is a library in `ui-studio`; the Board is the first view, a widget of `ui-theia`. Board columns: To do holds `todo`; In progress holds `in_progress`, `submitted` (marked in review), `changes_requested` (marked changes asked) and `blocked` (marked blocked); Done holds `approved` (ADR-051). The Flow view draws the tasks as nodes, one level after the deepest task they wait for, and `dependsOn` as edges; the agents stand as nodes in a column before the tasks, each with an edge to the task it works on, dashed and lit while the agent thinks \[D\].

The Studio view is the Team panel's third view, on the same fold (ADR-052). Its first cut draws primitives; sprites, Kenney assets and the animations of the table below come with the theme module. The stage takes the tokens of the Design system in the mode of Theia's theme (high contrast dark as dark, high contrast light as light); the DOM panels keep Theia's colours. Desk rows come from events: a role seen approving or reviewing sits in the top row. An agent waits at the coffee corner while its run is paused for quota and its current provider's quota is exhausted and not yet restored. The effects of the table below play for live events only, so a panel opened later draws the state; an effect aimed at a role plays at that role's first character and is skipped when it has none \[D\].

Scene layout \[D\]: a top-down room generated from the team. Roles that plan or approve sit in the top row; other roles in the bottom row; at most 6 desks per row. Fixed props: the task board on the wall (columns To do, In progress, Done), a coffee corner (quota waits), a bookshelf (the vault), a window showing the user's local time of day (can be turned off), plants and a clock. More than 12 agents are grouped into one character per role with a count badge \[C\].

Characters: one per agent, colored by role. Accessories by role kind: pencil for designer, glasses for lead, hood for developer, beret for artist, headset for tester, clipboard for PM; other roles get one from a seeded set \[D\]. Labels show the role name; a setting switches to friendly first names \[D\].

| Event | What the studio shows |
| --- | --- |
| `task.created` | A sticky note drops into To do |
| `task.assigned` | An envelope flies from the assigner to the agent; the note moves to In progress |
| `task.status.changed` to `approved` | The note moves to Done with a sparkle; small confetti at the approver |
| `task.status.changed` to `changes_requested` | An envelope flies back to the agent with a short "!" |
| `task.status.changed` to `blocked` | A red pin on the note; a red "!" above the agent |
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

The tokens below come from the approved demo \[D\].

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

- Typeface: Baloo 2 (weights 500 to 800) for METE panels and the studio; the editor and terminal keep Theia's monospace font. Font files are bundled, never loaded from the internet \[D\].
- Shape: 1.5 px borders; radius 10 px for controls, 14 to 16 px for panels, 20 px for the studio stage \[D\].
- Keyboard-first: every METE action is a command in Theia's command palette (for example "METE: Start run", "METE: Stop all", "METE: Open approvals") and reachable by keyboard with a visible focus ring \[C\].
- Copy: sentence case, plain verbs, errors say what happened and what to do next, no apologies \[D\].
- Localization: English default and Turkish; every UI string lives in resource files \[D\].
