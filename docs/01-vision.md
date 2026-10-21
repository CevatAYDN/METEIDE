# 01 Vision

Repository file: `docs/01-vision.md`. Depends on: none.

METE IDE exists so that people without paid AI subscriptions can run real projects with teams of free models; free models are the default, and paid models are an option for those who want them (ADR-042). It wins by system design, not by model strength.

## Problem

- Paid AI IDEs depend on strong paid models. Free models are weaker one by one, rate limited, and their catalog changes often.
- Existing multi-agent frameworks (ChatDev, CrewAI, MetaGPT) are Python libraries. Their managers are LLMs, their pipelines are fixed to a software company, they target one-shot greenfield apps, and none of them is quota-aware or a desktop product.

## Product promise

No model to install, no GPU, no payment: only an internet connection. Node.js and Python runtimes that some plugins need are downloaded by METE itself, without user action.

## Goals

| Id | Goal |
| --- | --- |
| G1 | Teams: run agent teams with roles, a different model per role, a deterministic workflow, reviews and approvals \[C\] |
| G2 | Free: work entirely on free providers through a multi-provider quota pool that pauses and resumes \[C\] |
| G3 | Domain-agnostic: team templates for research, SEO audit, web development and game studio; daily tasks through a single agent \[C\] |
| G4 | Modular: every provider, tool and integration is a module; removing one never breaks the system \[C\] |
| G5 | Extensible: full MCP support, custom endpoints, plugins, Agent Skills, VS Code extensions from Open VSX \[C\] |
| G6 | Knowledgeable: code knowledge graph, two-layer Obsidian-compatible vault, hybrid search \[C\] |
| G7 | Autonomous when allowed: autonomy levels 0 to 3, triggers, checkpoints, rollback \[C\] |
| G8 | Visible: studio, flow and board views plus replay; every visual maps to a real event \[C\] |
| G9 | Premium and fast: own design system, keyboard-first, lazy modules, a UI thread that never blocks \[C\] |
| G10 | Parity and more: every feature of paid IDEs that free limits allow; tab completion is an optional module \[C\] |

## Non-goals

- Shipping, downloading, managing or recommending local models \[C\]. A custom endpoint MAY point to any URL the user types, including localhost; METE does not block it and does not support it either \[D\].
- Training or fine-tuning models.
- Running servers or a cloud service. METE has no backend.
- Earning money. There is no paid tier \[C\].
- Competing on raw model quality.
- Telemetry of any kind \[D\].
- Requiring Docker or GitHub Actions \[C\].

## Positioning

METE is not "a free Cursor". It is an open-source agent-team platform that does what paid tools structurally cannot \[C\]:

- Provider freedom: any provider, any custom endpoint.
- Real teams: roles, workflows, handoffs and approvals, not one agent with helpers.
- Model diversity as a weapon: cross-family review and best-of-N attempts.
- A learning router that finds which free model is good at which job.
- Transparency: every agent decision is logged and replayable.
- No lock-in: knowledge is plain Markdown and git.

## Users

- First user: the founder, a game developer on Windows, building his own projects with METE (dogfooding) \[C\].
- Then: developers without AI budgets, indie game developers, web developers, SEO practitioners, students and open-source contributors.

## Success criteria

- MVP: the four lite templates pass their acceptance scenarios from the Roadmap tab using only free providers \[C\].
- From the end of Phase 1, METE writes parts of itself (self-hosting) \[C\].
- In chaos tests, removing any optional module (06 Kernel and modules) leaves the app able to start and finish a single-agent task \[C\].

## Design principles

1. Code orchestrates, models perform. Workflows are state machines; models fill roles \[C\].
2. Capabilities, not tools. Core and templates name what to do, never which tool does it \[C\].
3. Fail soft. Every capability has a fallback chain that ends in something that always works \[C\].
4. Never call a model for work code can do: search with grep, find with the graph \[C\].
5. Verify by machine, not by claim: tests, builds and audits decide "done" \[C\].
6. Quota is a first-class resource, planned like time and memory \[C\].
7. Everything visible is real: no fake animation in any view \[C\].
8. Small safe steps: small edits, checkpoint before writes, human approval at chosen gates \[C\].
9. Privacy by default: training providers off, secrets masked, ignored paths never sent \[C\].
10. Compatibility over reinvention: MCP, Agent Skills, Open VSX, OpenAI-compatible APIs, Obsidian Markdown \[C\].
