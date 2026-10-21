# 18 FAQ

Repository file: `docs/18-faq.md`. Depends on: all specification tabs.

Each answer is binding and names the tab that holds the full rule. A question not answered here or in the tabs is an open question and MUST be raised, not guessed.

## Product

| Question | Answer | Tab |
| --- | --- | --- |
| Is METE free? | Yes. It needs no paid service. Only macOS signing would cost money, and it is out of scope until macOS work starts | Overview |
| Do I need a GPU? | No. All models run at free cloud providers | 01 |
| Does it work offline? | No. Runs pause when the network is lost and resume when it returns | 03 |
| Can I use local models? | METE does not ship, manage or support them. A custom endpoint accepts any URL, including localhost, without support | 01 |
| Can I use a paid provider? | Yes. From Phase 2 the model mode `paid` or `both` admits paid models from OpenRouter, a custom endpoint or any provider with priced models, under a daily spending cap; `both` uses free models first and paid ones when the free limits run out. METE is designed and tested for free providers and never requires a paid one (ADR-042) \[D\] | 09 |
| Which platforms? | Windows 10 and 11 first, Linux built through WSL2, macOS after the MVP | Overview |
| Can companies use it commercially? | Yes. Apache-2.0 | 04 |
| Is there telemetry? | No. Logs stay on the machine; an opt-in memory server the user runs receives only vault notes and handoffs (Phase 7) | 04, 11 |

## Models and quota

| Question | Answer | Tab |
| --- | --- | --- |
| A free model disappeared. What breaks? | Nothing. Templates name tiers; the next model in the tier chain takes over | 09 |
| All quota is used. What happens? | The run pauses until the earliest reset and then resumes by itself | 09 |
| Should I buy OpenRouter credits? | Optional. A lifetime purchase of 10 credits raises the free daily limit from 50 to 1,000 requests | 09 |
| Do more accounts raise limits? | No. OpenRouter governs limits globally, so extra accounts or keys do not raise them | 09 |
| Where are my API keys? | In the operating system keychain only | 12 |
| Is my code sent to providers? | Only what an agent needs for its task, with secrets masked; `.meteignore` files never; providers that train on prompts are off by default; `sensitive` workspaces use stricter models | 09 |
| How does METE learn which model is good? | The learning router scores models per role and task kind from verify results, revisions and cost | 09 |
| Does any provider ask for a card? | OpenCode Zen asks for billing details before it issues a key, even for its free models. NVIDIA Build, OpenRouter free models, Tavily and Exa do not. Brave now requires a card and is excluded | 09 |

## Teams and orchestration

| Question | Answer | Tab |
| --- | --- | --- |
| How do I make my own team? | Write a YAML template in `.mete/teams/` or use the visual template editor in Settings | 08, 13 |
| Can I run CrewAI, MetaGPT or ChatDev? | Yes, as optional engines with `engine: crewai`, `metagpt` or `chatdev`; their calls still pass the gateway | 08 |
| Who decides that a task is done? | Verify gates, the guardrail and the approver. A model's claim never decides | 08 |
| What if the lead keeps rejecting? | After 3 revisions the task is blocked and the human decides | 07 |
| What if two agents edit the same file? | The task list assigns file ownership, each writer has a worktree, and conflicts become a merge task | 08 |
| Does a simple request start a whole team? | No. The router sends simple requests to a single agent | 08 |
| Do the team's budgets and the policy budget conflict? | The run uses the smaller of the two | 12 |

## Tools, MCP and plugins

| Question | Answer | Tab |
| --- | --- | --- |
| How do I add an MCP server? | Settings, MCP servers, or `.mete/mcp.yaml`. Needed runtimes download by themselves | 10 |
| Can agents install plugins? | No. Agents may propose; only the user installs, after seeing permissions | 10, 12 |
| How do I use Blender, 3ds Max, Unity or Unreal? | Add its MCP server or CLI, connect it with a mapping file, and bind it to the capability. Templates stay unchanged | 10 |
| A capability has no adapter. What happens? | Its defined empty-chain behavior runs; the UI names the missing capability and suggests registry entries | 06 |
| Do I need Python? | No manual install. uv downloads Python when a server needs it | 10 |
| Do I need Docker? | No. It is used only for container-based MCP servers, and only if already installed | 10, 12 |
| Do VS Code extensions work? | Yes, from Open VSX through Theia. They become agent tools only if they expose MCP | 10 |
| Does web search need a key? | Not from Phase 3: the default is Exa MCP without a key, and free keys add fallbacks. Until the MCP client comes, `web.search@1` needs a free Tavily key (`mete key set tavily`) | 06, 10 |
| Can other tools use METE? | Yes. `mete mcp` exposes teams and knowledge as MCP tools | 10 |

## Knowledge

| Question | Answer | Tab |
| --- | --- | --- |
| Where is my second brain? | The personal vault folder chosen at onboarding; it opens in Obsidian | 11 |
| Will agents fill my vault with junk? | No. Note types are limited, 3 new notes per run, duplicates update existing notes, and consolidation needs approval | 11 |
| Can I hide a note from AI? | Yes. `private: true` in its frontmatter | 11 |
| Does indexing spend quota? | The structural graph and keyword index do not. Embeddings and the semantic pass do, at low priority and cached | 11 |

## Autonomy and safety

| Question | Answer | Tab |
| --- | --- | --- |
| What is the default autonomy? | Level 2: reads, workspace writes and allow-listed commands run; risky actions ask | 12 |
| How do I undo agent changes? | Restore a checkpoint with one click | 12 |
| How do I stop everything? | "Stop all" or `Ctrl+Shift+.` | 12 |
| Can agents change their own permissions? | No. Policy, bindings and MCP files are protected paths | 12 |
| Can a team work overnight? | Yes, through triggers; runs pause on quota and resume after resets; level 3 needs worktrees or snapshots | 12 |
| What happens when something crashes? | The supervisor restarts modules; the desktop restarts the daemon; runs resume from snapshots | 03 |

## Interface

| Question | Answer | Tab |
| --- | --- | --- |
| Is the studio animation real? | Yes. Every movement is drawn from an event | 13 |
| Can I speed up the studio? | Only in Replay. The live view runs in real time | 13 |
| Which languages? | English and Turkish | 13 |

## Building METE

| Question | Answer | Tab |
| --- | --- | --- |
| What do I use before METE can build itself? | OpenCode with free models, or Cline or Kilo Code with OpenRouter free models | 16 |
| What must an AI agent read first? | `AGENTS.md` | 17 |
| How do I change a decision? | Write a new ADR that supersedes the old one | 04 |
| How do tests avoid spending quota? | Hand-written fetch fakes and scripted adapters answer instead of providers; MSW cassettes will replay recorded responses once `pnpm test:record` exists | 15 |
| Where does CI run? | On the developer's machine, through lefthook | 15 |
| What is the MVP? | The end of Phase 5, version 0.1.0 | 16 |
| Which database? | SQLite: one global file and one per workspace | 03 |
