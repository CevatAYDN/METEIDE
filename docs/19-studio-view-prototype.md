# 19 Studio view prototype

Repository file: `docs/19-studio-view-prototype.md`. Depends on: 08 Orchestration and teams, 09 Models, providers and quota, 13 UI and studio view.

The prototype `docs/prototypes/studio-view.html` is a single self-contained page that shows one team working through a sprint as small characters in a studio. It is a visual reference for tab 13, not a specification: where it and tabs 08, 09 or 13 disagree, the tabs win. Open it in any browser; the UI text is Turkish.

## Screen

| Area | Shows |
| --- | --- |
| Header | Team goal, sprint number, sprint progress bar, pause/play, speed 1× / 2× / 4× |
| Stage (canvas, 16:9) | Six desks, task board (To do / In progress / Done), coffee spot, Vault shelf, window with a day/night cycle |
| Character card | Opens on click: name, role, model tier, provider, status, current task, request count |
| Events panel | Last 7 events, newest first, with studio clock time |
| Free quota pool | One bar per provider; green, amber above 70 %, red at 95 % or when full |

Keyboard: Escape closes the card, Space pauses. `prefers-reduced-motion` reduces particles.

## Team in the prototype

| Character | Role | Tier | Provider |
| --- | --- | --- | --- |
| Deniz | Designer | reasoning | NVIDIA |
| Ece | Project manager | reasoning | OpenRouter |
| Kaan | Lead | reasoning | NVIDIA |
| Arda | Developer | coder | OpenCode Zen |
| Mina | Artist | image-gen | NVIDIA |
| Bora | Tester | coder | OpenRouter |

Agent statuses: idle, working, thinking, waiting for quota, found an error, happy, walking.

## Sprint scenario (loops over three game goals)

1. The user gives a goal; a document flies to the designer.
2. Designer runs a web search, writes the GDD, walks to the lead; lead reviews and approves.
3. Project manager posts three tasks on the board and sends one to developer, artist and tester.
4. Developer branch: first build → tester runs tests, one fails → report goes to lead → lead assigns the fix → developer fixes → tester re-runs, all pass → both notes move to Done.
5. Artist branch (in parallel): NVIDIA quota is full → artist waits at the coffee spot with a countdown → quota refills → artist resumes, generates the concept image → lead approves.
6. Lead closes the sprint; the lesson is saved to the Vault as a new book.

Quota behavior shown: a full provider makes the agent wait and resume where it stopped; the daily OpenRouter quota resets at the start of each studio day.

## Gaps against the specification

- `image-gen` is not one of the tiers in AGENTS.md (reasoning, coder, fast, long-context, vision). Tab 09 must add it or the prototype must change.
- The prototype names providers and a model ("FLUX") per agent. Core code and templates MUST NOT; in the product these come from bindings.
- Quota maximums (40/min, 50/day, 200/day, 1000 web credits/month) are illustration values, not defaults.
- OpenCode Zen is shown as a provider; tab 18 says it needs a card on file, which conflicts with the overview's card rule.
