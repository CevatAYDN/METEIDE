# 02 Glossary

Repository file: `docs/02-glossary.md`. Depends on: none.

Every term below has exactly one meaning across all tabs. Code identifiers use the English term in the left column.

| Term | Meaning |
| --- | --- |
| Adapter | Code or a declarative mapping that implements a capability contract on top of a concrete tool, service or provider (MCP server, CLI, HTTP API, native code) |
| Agent | A running instance of a role inside a run, bound to one model at a time |
| Approval | A gate where a lead agent or the human accepts or rejects a task result |
| Artifact | A typed, schema-validated work product stored as a file in the workspace (GDD, task list, report, code change, image, 3D model) |
| Autonomy level | Integer 0 to 3 that sets which actions run without human approval |
| Binding | Workspace setting that says which adapters serve a capability, in fallback order |
| Capability | A named, versioned unit of functionality, for example `knowledge.search@1` |
| Capability contract | Zod input and output schemas plus required and optional features of a capability |
| Checkpoint | A restorable snapshot taken before a step that writes |
| Clarification | A question an agent asks the task giver before starting work |
| Code knowledge graph | Nodes (files, symbols, concepts) and edges (imports, calls, references) extracted from a workspace |
| Custom endpoint | A user-added provider defined by base URL, API key, headers and API format |
| Event | An immutable record of something that happened, published on the event bus |
| Event bus | In-process publish and subscribe channel; the only way modules observe each other |
| Fallback chain | Ordered list of adapters or models tried until one succeeds |
| Gateway | Local OpenAI-compatible HTTP endpoint inside METE; every outbound model call passes through it |
| Guardrail | Machine check on a task output (schema, rule) with a bounded retry |
| Hybrid search | Keyword, vector, graph and backlink results fused into one ranked list |
| Integration level | How an external tool is connected: 1 raw, 2 mapping file, 3 code adapter |
| Kernel | The minimal core: module loader, capability registry, event bus, configuration, lifecycle |
| Learning router | Component that scores models per role and task type from past results |
| Lesson | A vault note recording what worked or failed in a run |
| Managed runtime | Node.js, Python (through uv) or a binary that METE downloads to run an MCP server or engine adapter |
| MCP | Model Context Protocol; the standard for connecting external tools |
| Model tier | A capability class of models, for example `reasoning` or `coder`; templates name tiers, never model names |
| Module | A unit with a manifest, `activate` and `deactivate`; provides and consumes capabilities |
| Pair review | Bounded two-agent dialogue in which one role reviews another's output |
| Pattern | A reusable workflow shape: single, pipeline, hierarchical, parallel-then-synthesize, review loop |
| Policy | Workspace rules for autonomy, permissions, budgets and blocked actions |
| Provider | A source of models (NVIDIA Build, OpenRouter, OpenCode Zen, a custom endpoint) |
| Quota pool | Shared accounting of all provider limits across all runs |
| Quota unit | One kind of limit: requests per minute or day, tokens per minute, credits per month, GPU seconds per day |
| Registry | A source that lists installable plugins, MCP servers, skills or templates |
| Replay | Playback of a past run from its event log |
| Revision limit | Maximum number of times a task may be sent back before it is blocked |
| Role | A definition in a team template: id, goal, backstory, tier, capabilities |
| Run | One execution of a team template or a single-agent task |
| Skill | A folder with `SKILL.md` instructions for a kind of work (Agent Skills format) |
| Sprint | User-interface word for one run of a team template |
| Studio view | Animated view where agents appear as small characters; driven only by events |
| Task | A unit of work assigned to one role inside a run, with a state machine |
| Team | The set of agents created from a team template for one run |
| Team template | YAML file defining roles, workflow, tasks and policies for a kind of work |
| Trigger | Something that starts a run: manual, schedule, file change, issue source, webhook |
| Vault | A folder of Obsidian-compatible Markdown notes; personal (global) or workspace (per project) |
| Verify gate | A machine check that must pass before a task can be submitted |
| Workspace | A folder opened in METE; has a `.mete/` folder; may or may not be a git repository |
| Worktree | A git working copy created for one agent so parallel writes never collide |
