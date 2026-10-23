# METE IDE — AI-Ready Documentation

Oct 21, 2026 · @Lazury

## What METE IDE is

METE IDE is an open-source, cross-platform desktop agent workspace that runs teams of AI agents on free cloud model providers. Each team member is an agent with a role, a model tier and a set of capabilities; the team works through a deterministic workflow with handoffs, reviews and approvals.

Mission: turn free AI models into production power that anyone can use, by making them work together as a team.

METE IDE is domain-agnostic. Game development, web development, SEO, research and daily work are delivered as team templates on top of one core. Every tool, provider and integration is a replaceable module; removing a module MUST NOT break the system.

## Project facts

| Item | Value |
| --- | --- |
| Name | METE IDE (repository and package scope: `mete`, `@mete/*`; CLI binary: `mete`) |
| License | Apache-2.0 |
| Platforms | Windows 10/11 64-bit first; Linux built and smoke-tested through WSL2 in Phase 1, and a run on a native Linux desktop is a release gate before any Linux package is published \[D\]; macOS after the public MVP |
| Models | Free cloud providers only: NVIDIA Build, OpenRouter `:free` models, OpenCode Zen free models, Hugging Face Spaces through MCP. No local models. Internet is required. A provider stays in the default chain only while its free models cost nothing to use; OpenCode Zen stays even though it asks for billing details before it issues a key \[C\]; the chain lives in configuration and its first entry is re-verified at each release \[D\] |
| Language | TypeScript in strict mode; Rust through napi-rs only for hot paths proven by measurement |
| Runtime | Node.js 24 LTS for the core daemon, CLI and tooling; the desktop shell is Eclipse Theia on Electron and runs the Node bundled with Theia's pinned Electron \[D\] |
| Managed runtimes | Node.js and Python (through uv) are downloaded on demand to run MCP servers and optional engine adapters; versions and their SHA-256 are pinned in code (`packages/mcp/src/defaults.ts`, tab 10), downloaded only from official release URLs and SHA-256 verified before first use \[D\] |
| Repository | pnpm workspaces + Turborepo monorepo; `node-linker` is set to what Theia's build requires, with `hoisted` as the starting assumption \[D\] |
| Documentation language | English, so every model can read it; the user interface ships in English and Turkish |
| Cost to build and run | No paid service is required. Windows builds ship unsigned first and the README explains the SmartScreen warning; free Windows signing through SignPath Foundation is Phase 7 (tab 15). macOS code signing is the only known paid item and is out of scope until macOS work starts |
| Excluded by decision | Local models, Docker as a requirement, GitHub Actions, telemetry |

## How to use this documentation

AI coding agents start with 17 AGENTS.md, then follow its reading list; humans start here, then read tabs 01 to 04 and the tab for their area. This overview becomes `docs/README.md` in the repository.

| Tab | Repository file | Answers |
| --- | --- | --- |
| 01 Vision | `docs/01-vision.md` | Why METE exists, goals, non-goals, principles |
| 02 Glossary | `docs/02-glossary.md` | The one meaning of every term |
| 03 Architecture | `ARCHITECTURE.md` | Layers, processes, data locations, repository layout |
| 04 Decisions (ADR) | `docs/adr/` | 63 accepted decisions with reasons |
| 05 Tech stack | `docs/05-tech-stack.md` | Every allowed technology and license rule |
| 06 Kernel and modules | `docs/06-kernel-and-modules.md` | Kernel API, module catalog, capability catalog |
| 07 Domain model and events | `docs/07-domain-model-and-events.md` | Entities, state machines, event catalog |
| 08 Orchestration and teams | `docs/08-orchestration-and-teams.md` | Router, patterns, template schema, task lifecycle, built-in templates |
| 09 Models, providers and quota | `docs/09-models-providers-quota.md` | Providers, tiers, gateway, privacy, quota pool, scheduler |
| 10 Tools, MCP and runtimes | `docs/10-tools-mcp-runtimes.md` | Built-in tools, full MCP, adapters, runtimes, registries |
| 11 Knowledge layer | `docs/11-knowledge-layer.md` | Code graph, vaults, hybrid search, indexing |
| 12 Autonomy and security | `SECURITY.md` | Autonomy levels, policy, threat model, checkpoints, triggers |
| 13 UI and studio view | `docs/13-ui-and-studio-view.md` | Screens, studio view event mapping, design tokens |
| 14 Coding standards | `CONTRIBUTING.md` | SOLID and clean code rules, definition of done |
| 15 Testing, build and release | `docs/15-testing-build-release.md` | Tests, local CI, builds, releases |
| 16 Roadmap | `ROADMAP.md` | Phases, exit gates, Phase 1 task order |
| 17 AGENTS.md | `AGENTS.md` | Rules and workflow for AI coding agents |
| 18 FAQ | `docs/18-faq.md` | Binding answers to common questions |
| 19 Studio view prototype | `docs/19-studio-view-prototype.md` | Visual reference of a team working a sprint (`docs/prototypes/studio-view.html`) |

## Conventions

Every specification tab follows the same rules, so humans and models read them the same way.

- Normative words: MUST, MUST NOT, SHOULD, SHOULD NOT and MAY follow RFC 2119. Anything not marked with them is explanation.
- Capability ids: `domain.action@major`, lower case, for example `knowledge.search@1`, `3d.cleanup@1`.
- Event types: `domain.entity.verb` in past tense, for example `task.assigned`, `quota.exhausted`.
- Module ids: kebab-case, unique, for example `knowledge-graph`. Packages: `@mete/<name>`.
- Workspace folder: every workspace keeps METE files in `.mete/` at its root. The ignore file is `.meteignore`.
- Time: ISO 8601 in UTC. Ids: `crypto.randomUUID()` unless a tab says otherwise.
- Provenance tags: \[C\] = decided in the design conversation; \[D\] = fixed by this documentation where the conversation left it open.
- Default values: numbers marked "default" are starting values. They live in configuration and MUST NOT be hardcoded in logic.
- Source of truth: when code and this documentation disagree, the documentation wins until an ADR in the Decisions tab changes it.

## Decision provenance

Every decision in this documentation comes from the design conversation \[C\] or was fixed here to close a gap \[D\]; nothing is left as an unstated assumption. Every \[D\] item is tagged where it appears; the most important ones are also ADRs in the Decisions tab.

Decisions fixed by this documentation \[D\], in short: English documentation; the `.mete/` folder name; `team.engine@1` as the name of the team engine capability (to avoid a clash with game engines); the core running as a separate daemon process; no telemetry; Windows installer and Linux package formats; default numbers for limits and timeouts; the vault folder layout; the learning router formula; Conventional Commits; quota as a hard constraint (every team template MUST declare a per-task request and token budget, and the scheduler MUST pause on `quota.exhausted` instead of assuming paid credit); local release builds (a maintainer produces release artifacts locally from the lockfile, and the release notes record toolchain versions and the lockfile hash); until `docs/adr/` exists, this overview is the interim source of truth.

Ideas discussed earlier in the conversation and later replaced. An implementation MUST NOT use them:

| Superseded idea | Replaced by |
| --- | --- |
| Local models for heavy work, offline mode | Free cloud providers only, pause on network loss |
| Docker or Podman sandbox as a requirement | Tool-level limits, git worktrees, command allow list; containers only as an optional MCP runtime |
| GitHub Actions for CI and background agents | Local CI with lefthook; METE's own trigger engine |
| Bottleneck for quota | p-queue plus METE's own multi-unit token buckets |
| Python removed from the system | Python as a managed runtime through uv |
| Python engines as the main team engine | Native TypeScript engine; CrewAI, MetaGPT and ChatDev only as optional adapters |
| Tool names inside templates, for example `tool: blender-mcp` | Capability ids inside templates; tools only in bindings |
| `.crew/` folder and `.crewignore` | `.mete/` and `.meteignore` |
| SearXNG through WSL2 as the default search | Exa MCP without a key as default, then a fallback chain |
| Brave Search API in the default chain | Removed: it now needs a card on file |

## Open verifications

These assumptions are not yet verified. Each MUST be checked before the work that depends on it (provider adapters in Phase 1 task 6, Theia in Phase 5, release builds at release); the failure path is already decided.

- Free limits: the current limits of NVIDIA Build, OpenRouter `:free`, OpenCode Zen and Hugging Face Spaces through MCP are recorded in tab 09 with their retrieval date, and the smallest built-in template MUST complete a task inside them. Fail: the provider leaves the default chain.
- Theia toolchain: Theia's pinned release builds under pnpm with the chosen `node-linker` and runs on the Node bundled in its Electron. Fail: the linker setting changes; the Node 24 rule stays scoped to the daemon and CLI.
- Default search: Exa MCP still works without a key and without a card. Fail: the next entry in the fallback chain becomes the default.
- Release builds: artifacts built on two maintainer machines from the same lockfile match. Fail: tab 15 adds a reproducibility step.
